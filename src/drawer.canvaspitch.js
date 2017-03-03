/**
 * This is a drawer which extends the canvas drawer but adds pitch information to
 * move the base line of the wave vertically depending on pitch.
 *
 * Pitch data can be generated by using the PRAAT open source sound editing software
 * by doing the following:
 *
 * - Load the sound file you want to generate pitch for (Open->Read From File)
 * - Analyse the pitch (Analyse Periodicy->To Pitch)
 * - Convert to pitch Tier (Convert -> Down to Pitch Tier)
 * - Save as Text File (Save -> Save as Headerless Spreadsheet File)
 *
 * Params which can be sent in as initialization values are the following
 * - pitchArray:             array of objects with time and pitch (required unless pitchFileUrl is set)
 * - pitchFileUrl:           url of the file that contains the pitch information (required unless pitchArray is set)
 * - pitchTimeStart:         the time of the pitch file which corresponds with the start of the displayed wave (defaults to 0)
 * - pitchTimeEnd:           the time of the pitch file which corresponds with the end of the displayed wave (defaults maximum pitch time)
 * - normalizePitchTo:       [whole/segment/none/values] - what value to normalize the pitch to
 * - pitchColor:
 */


'use strict';

WaveSurfer.Drawer.CanvasPitch = Object.create(WaveSurfer.Drawer.Canvas);

WaveSurfer.util.extend(WaveSurfer.Drawer.CanvasPitch, {

    defaultCanvasPitchParams: {
        pitchColor     : '#f63',
        pitchProgressColor : '#F00',
        pitchTimeStart: 0,
        pitchNormalizeTo: 'values',
        pitchMin: 70,
        pitchMax: 200,
        pitchPointHeight: 2,
        pitchPointWidth: 2,
        splitChannels: false,
    },

    //object variables that get manipulated by various object functions
    pitchTimeStart: 0,  //the start time of our wave according to pitch data
    pitchTimeEnd: -1,   //the end of our wave according to pitch data
    pitchArray: [],     //array of pitch data objects containing time and pitch value
    pitches: [],        //calculated average pitches at points in our wave

    /**
     * Initializes the pitch array. If params.pitchFileUrl is provided an ajax call will be
     * executed and drawing of the wave is delayed until pitch info is retrieved
     * @param params
     */
    initDrawer: function (params) {
        this.params = WaveSurfer.util.extend(this.defaultCanvasPitchParams, params)
        var my = this;


        //check to see if pitchTimeStart is set
        this.pitchTimeStart = this.params.pitchTimeStart;

        //check to see if pitchTimeStart is set
        if(this.params.pitchTimeEnd !== undefined) {
            this.pitchTimeEnd = this.params.pitchTimeEnd;
        }

        this.pitchArrayLoaded = false;
        if (Array.isArray(params.pitchArray)) {
            this.pitchArray = params.pitchArray;
            this.pitchArrayLoaded = true;
        }
        //Need to load the pitch array from ajax with our callback
        else {
            var onPitchArrayLoaded = function (pitchArray) {
                my.pitchArray = pitchArray;
                my.pitchArrayLoaded = true;
                my.fireEvent('pitch_array_loaded');
            }
            this.loadPitchArrayFromFile(params.pitchFileUrl, onPitchArrayLoaded);
        }
    },

    /**
     * Draw the peaks - make sure the pitchArray is loaded first
     * @param peaks
     * @param length
     * @param start
     * @param end
     */
    drawPeaks: function (peaks, length, start, end) {
        if (this.pitchArrayLoaded == true) {

            //adjust height to split into wave and pitch channels
            this.setWidth(length);

            this.params.barWidth ?
                this.drawBars(peaks, 0, start, end) :
                this.drawWave(peaks, 1, start, end);

            this.calculatePitches();
            this.drawPitches(0);


            //set height back
            //this.params.height = this.params.height * 2;
            this.params.pixelRatio = 2;
        }
        //wait for the pitch array to be loaded and then draw again
        else {
            var my = this;
            my.on('pitch-array-loaded', function () {
                my.drawPeaks(peaks, length, start, end)
            });
        }
    },

    drawWave: function (peaks, channelIndex, start, end) {
        var my = this;


        // Support arrays without negative peaks
        var hasMinValues = [].some.call(peaks, function (val) { return val < 0; });
        if (!hasMinValues) {
            var reflectedPeaks = [];
            for (var i = 0, len = peaks.length; i < len; i++) {
                reflectedPeaks[2 * i] = peaks[i];
                reflectedPeaks[2 * i + 1] = -peaks[i];
            }
            peaks = reflectedPeaks;
        }

        // A half-pixel offset makes lines crisp
        var $ = 0.5 / this.params.pixelRatio;
        var height = this.params.height * this.params.pixelRatio / 2;
        var offsetY = height * channelIndex || 0;
        var halfH = height / 2;
        var length = ~~(peaks.length / 2);

        var scale = 1;
        if (this.params.fillParent && this.width != length) {
            scale = this.width / length;
        }

        var absmax = 1;
        if (this.params.normalize) {
            var max = WaveSurfer.util.max(peaks);
            var min = WaveSurfer.util.min(peaks);
            absmax = -min > max ? -min : max;
        }

        this.waveCc.fillStyle = this.params.waveColor;
        if (this.progressCc) {
            this.progressCc.fillStyle = this.params.progressColor;
        }

        [ this.waveCc, this.progressCc ].forEach(function (cc) {
            if (!cc) { return; }

            cc.beginPath();
            cc.moveTo(start * scale + $, halfH + offsetY);

            for (var i = start; i < end; i++) {
                var h = Math.round(peaks[2 * i] / absmax * halfH);
                cc.lineTo(i * scale + $, halfH - h + offsetY);
            }

            // Draw the bottom edge going backwards, to make a single
            // closed hull to fill.
            for (var i = end - 1; i >= start; i--) {
                var h = Math.round(peaks[2 * i + 1] / absmax * halfH);
                cc.lineTo(i * scale + $, halfH - h + offsetY);
            }

            cc.closePath();
            cc.fill();

            // Always draw a median line
            cc.fillRect(0, halfH + offsetY - $, this.width, $);
        }, this);
    },
    /**
     * Loop through the calculated pitch values and actually draw them
     */
    drawPitches: function(channelIndex) {
        var height = this.params.height * this.params.pixelRatio / 2;
        var offsetY = height * channelIndex || 0;


        this.waveCc.fillStyle = this.params.pitchColor;
        this.progressCc.fillStyle = this.params.pitchProgressColor;
        for(var i in this.pitches) {
            var x = parseInt(i);
            var y = offsetY + (height - this.params.pitchPointHeight) - (this.pitches[i] * (height - this.params.pitchPointHeight));
            this.waveCc.fillRect(x, y, this.params.pitchPointWidth, this.params.pitchPointHeight);
            this.progressCc.fillRect(x, y, this.params.pitchPointWidth, this.params.pitchPointHeight);
        }

    },

    /**
     * This function loops through the pitchArray and converts it to the pitches
     * to be drawn on the canvas keyed by their position
     */
    calculatePitches: function() {
        //reset pitches array
        this.pitches = {};

        //make sure we have our pitchTimeEnd
        this.calculatePitchTimeEnd();

        var pitchesForAverage = [];
        var previousPosition = -1;
        var maxPitch = 0;
        var minPitch = 99999999999;
        var maxSegmentPitch = 0;
        var minSegmentPitch = 99999999999;
        var duration = this.pitchTimeEnd - this.pitchTimeStart;

        for(var i = 0; i < this.pitchArray.length; i++) {
            var dataPoint = this.pitchArray[i];
            if(dataPoint.pitch > maxPitch) maxPitch = dataPoint.pitch;
            if(dataPoint.pitch < minPitch) minPitch = dataPoint.pitch;

            //make sure we are in the specified range
            if(dataPoint.time >= this.pitchTimeStart && dataPoint.time <= this.pitchTimeEnd) {
                var pitchPosition = Math.round(this.width * (dataPoint.time - this.pitchTimeStart) / duration);

                pitchesForAverage.push(dataPoint.pitch);

                //if we have moved on to a new position in our wave record average and reset previousPosition
                if(pitchPosition !== previousPosition) {
                    if(pitchesForAverage.length > 0) {
                        //get the average pitch for this point
                        var avgPitch = this.avg(pitchesForAverage);

                        //check for min max
                        if(avgPitch > maxSegmentPitch) maxSegmentPitch = avgPitch;
                        if(avgPitch < minSegmentPitch) minSegmentPitch = avgPitch;

                        //add pitch to the position
                        this.pitches[previousPosition] = avgPitch;
                        pitchesForAverage = [];
                    }
                }
                previousPosition = pitchPosition;
            }
        }

        //normalize the pitches
        if(this.params.pitchNormalizeTo == 'whole') {
            this.normalizePitches(minPitch, maxPitch);
        }
        else if(this.params.pitchNormalizeTo == 'values') {
            this.normalizePitches(this.params.pitchMin, this.params.pitchMax)
        }
        else {
            this.normalizePitches(minSegmentPitch, maxSegmentPitch);
        }
    },

    normalizePitches: function(min, max) {
        for(var i in this.pitches) {
            var pitch = (this.pitches[i] - min) / (max - min);
            if(pitch > 1) pitch = 1;
            if(pitch < 0) pitch = 0;
            this.pitches[i] = pitch;
        }
    },
    /**
     *
     */

    /**
     * Function to load the pitch array from a praat pitch tier text file via ajax
     *
     * The text file should contain a series of lines.
     * Each line should contain [audio time] [tab character] [pitch value]
     * e.g. "1.2355 [tab] 124.2321"
     * The file format can be generated by PRAAT open source audio editor
     *
     * @param pitchFileUrl  url of the praat pitch tier file
     * @param onSuccess          function to run on success
     */
    loadPitchArrayFromFile(pitchFileUrl, onSuccess) {
        var pitchArray = [];
        //Load the pitch file
        var options = {
            url: pitchFileUrl,
            responseType: 'text'
        };
        var fileAjax = WaveSurfer.util.ajax(options);

        fileAjax.on('load', function (data) {
            if (data.currentTarget.status == 200) {
                //split the file by line endings
                var pitchLines = data.currentTarget.responseText.split("\n");
                //loop through each line and find the time and pitch values (delimited by tab)
                for (var i = 0; i < pitchLines.length; i++) {
                    var pitchParts = pitchLines[i].split("\t");
                    if(pitchParts.length == 2) {
                        pitchArray.push({time: parseFloat(pitchParts[0]), pitch: parseFloat(pitchParts[1])});
                    }
                }
                //run success function
                onSuccess(pitchArray);
            }
        });
    },


    calculatePitchTimeEnd: function() {
        if(typeof this.params.pitchTimeEnd !== 'undefined') {
            this.pitchTimeEnd = this.params.pitchTimeEnd;
        }
        else {
            this.pitchTimeEnd = this.pitchArray[this.pitchArray.length -1].time;
        }
    },

    /**
     * Quick convenience function to average numbers in an array
     * @param values
     * @returns {number}
     */
    avg: function(values) {
        var sum = values.reduce(function(a,b) {return a+b;});
        return sum/values.length;
    }
});

WaveSurfer.util.extend(WaveSurfer.Drawer.CanvasPitch, WaveSurfer.Observer);
