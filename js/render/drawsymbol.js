'use strict';

var mat4 = require('../lib/glmatrix.js').mat4;

module.exports = drawSymbols;

function drawSymbols(gl, painter, bucket, layerStyle, posMatrix, params, imageSprite) {
    if (bucket.elementGroups.text.groups.length) {
        drawSymbol(gl, painter, bucket, layerStyle, posMatrix, params, imageSprite, 'text');
    }
    if (bucket.elementGroups.icon.groups.length) {
        drawSymbol(gl, painter, bucket, layerStyle, posMatrix, params, imageSprite, 'icon');
    }
}

var defaultSizes = {
    icon: 1,
    text: 24
};

function drawSymbol(gl, painter, bucket, layerStyle, posMatrix, params, imageSprite, prefix) {

    var info = bucket.info;

    var exMatrix = mat4.clone(painter.projectionMatrix);
    var angleOffset = (info[prefix + '-rotation-alignment'] === 'map' ? painter.transform.angle : 0) -
            (info[prefix + '-rotate'] || 0) * Math.PI / 180;

    if (angleOffset) {
        mat4.rotateZ(exMatrix, exMatrix, angleOffset);
    }

    // If layerStyle.size > info[prefix + '-max-size'] then labels may collide
    var fontSize = layerStyle[prefix + '-size'] || info[prefix + '-max-size'];
    var fontScale = fontSize / defaultSizes[prefix];
    mat4.scale(exMatrix, exMatrix, [ fontScale, fontScale, 1 ]);

    var text = prefix === 'text';
    var sdf = text; // TODO check if icon sprite is sdf
    var shader, buffer, texsize;

    gl.activeTexture(gl.TEXTURE0);

    if (sdf) {
        shader = painter.sdfShader;
    } else {
        shader = painter.iconShader;
    }

    if (text) {
        painter.glyphAtlas.updateTexture(gl);
        buffer = bucket.buffers.glyphVertex;
        texsize = [painter.glyphAtlas.width, painter.glyphAtlas.height];
    } else {
        imageSprite.bind(gl, angleOffset || params.rotating || params.zooming);
        buffer = bucket.buffers.iconVertex;
        texsize = [imageSprite.img.width, imageSprite.img.height];
    }

    gl.switchShader(shader, posMatrix, exMatrix);
    gl.uniform1i(shader.u_image, 0);
    gl.uniform2fv(shader.u_texsize, texsize);

    buffer.bind(gl);

    var ubyte = gl.UNSIGNED_BYTE;

    var stride = text ? 16 : 20;

    gl.vertexAttribPointer(shader.a_pos,          2, gl.SHORT, false, stride, 0);
    gl.vertexAttribPointer(shader.a_offset,       2, gl.SHORT, false, stride, 4);
    gl.vertexAttribPointer(shader.a_labelminzoom, 1, ubyte,    false, stride, 8);
    gl.vertexAttribPointer(shader.a_minzoom,      1, ubyte,    false, stride, 9);
    gl.vertexAttribPointer(shader.a_maxzoom,      1, ubyte,    false, stride, 10);
    gl.vertexAttribPointer(shader.a_angle,        1, ubyte,    false, stride, 11);
    gl.vertexAttribPointer(shader.a_rangeend,     1, ubyte,    false, stride, 12);
    gl.vertexAttribPointer(shader.a_rangestart,   1, ubyte,    false, stride, 13);

    if (text) {
        gl.vertexAttribPointer(shader.a_tex,          2, ubyte,     false, stride, 14);
    } else {
        gl.vertexAttribPointer(shader.a_tex,          2, gl.SHORT,  false, stride, 16);
    }

    // Convert the -pi..pi to an int8 range.
    var angle = Math.round((painter.transform.angle) / Math.PI * 128);

    // adjust min/max zooms for variable font sies
    var zoomAdjust = Math.log(fontSize / info[prefix + '-max-size']) / Math.LN2 || 0;

    var flip = info['symbol-rotation-alignment'] !== 'viewport' && info[prefix + '-keep-upright'];
    gl.uniform1f(shader.u_flip, flip ? 1 : 0);
    gl.uniform1f(shader.u_angle, (angle + 256) % 256);
    gl.uniform1f(shader.u_zoom, (painter.transform.zoom - zoomAdjust) * 10); // current zoom level

    // Label fading

    var duration = 300,
        currentTime = (new Date()).getTime();

    // Remove frames until only one is outside the duration, or until there are only three
    while (frameHistory.length > 3 && frameHistory[1].time + duration < currentTime) {
        frameHistory.shift();
    }

    if (frameHistory[1].time + duration < currentTime) {
        frameHistory[0].z = frameHistory[1].z;
    }

    var frameLen = frameHistory.length;
    if (frameLen < 3) console.warn('there should never be less than three frames in the history');

    // Find the range of zoom levels we want to fade between
    var startingZ = frameHistory[0].z,
        lastFrame = frameHistory[frameLen - 1],
        endingZ = lastFrame.z,
        lowZ = Math.min(startingZ, endingZ),
        highZ = Math.max(startingZ, endingZ);

    // Calculate the speed of zooming, and how far it would zoom in terms of zoom levels in one duration
    var zoomDiff = lastFrame.z - frameHistory[1].z,
        timeDiff = lastFrame.time - frameHistory[1].time;
    var fadedist = zoomDiff / (timeDiff / duration);

    if (isNaN(fadedist)) console.warn('fadedist should never be NaN');

    // At end of a zoom when the zoom stops changing continue pretending to zoom at that speed
    // bump is how much farther it would have been if it had continued zooming at the same rate
    var bump = (currentTime - lastFrame.time) / duration * fadedist;

    gl.uniform1f(shader.u_fadedist, fadedist * 10);
    gl.uniform1f(shader.u_minfadezoom, Math.floor(lowZ * 10));
    gl.uniform1f(shader.u_maxfadezoom, Math.floor(highZ * 10));
    gl.uniform1f(shader.u_fadezoom, (painter.transform.zoom + bump) * 10);

    var sdfFontSize = 24;
    var sdfPx = 8;
    var blurOffset = 1.19;
    var haloOffset = 6;

    if (sdf) {
        gl.uniform1f(shader.u_gamma, 2.5 / fontSize / window.devicePixelRatio);
        gl.uniform4fv(shader.u_color, layerStyle[prefix + '-color']);
        gl.uniform1f(shader.u_buffer, (256 - 64) / 256);
    }

    var begin = bucket.elementGroups[prefix].groups[0].vertexStartIndex,
        len = bucket.elementGroups[prefix].groups[0].vertexLength;

    gl.drawArrays(gl.TRIANGLES, begin, len);

    if (sdf && layerStyle[prefix + '-halo-color']) {
        // Draw halo underneath the text.
        gl.uniform1f(shader.u_gamma, (layerStyle['text-halo-blur'] * blurOffset / (fontSize / sdfFontSize) / sdfPx + (2.5 / fontSize)) / window.devicePixelRatio);
        gl.uniform4fv(shader.u_color, layerStyle['text-halo-color']);
        gl.uniform1f(shader.u_buffer, (haloOffset - layerStyle['text-halo-width'] / (fontSize / sdfFontSize)) / sdfPx);

        gl.drawArrays(gl.TRIANGLES, begin, len);
    }
    // gl.enable(gl.STENCIL_TEST);
}

// Store previous render times
var frameHistory = [];

// Record frame history that will be used to calculate fading params
drawSymbols.frame = function(painter) {
    var currentTime = (new Date()).getTime();

    // first frame ever
    if (!frameHistory.length) {
        frameHistory.push({time: 0, z: painter.transform.zoom }, {time: 0, z: painter.transform.zoom });
    }

    if (frameHistory.length === 2 || frameHistory[frameHistory.length - 1].z !== painter.transform.zoom) {
        frameHistory.push({
            time: currentTime,
            z: painter.transform.zoom
        });
    }
};