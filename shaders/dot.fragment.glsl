precision mediump float;

uniform vec4 u_color;
uniform float u_blur;

void main() {
	float dist = length(gl_PointCoord - vec2(0.5, 0.5));
	float t = smoothstep(0.5 - u_blur, 0.5, dist);

    gl_FragColor = u_color * (1.0 - t);
}