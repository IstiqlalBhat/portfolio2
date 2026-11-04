// The only three.js pieces the scene uses; importing through this module keeps the
// bundle tree-shaken and lets main.js evaluate three.js in its own task.
export {
  WebGLRenderer, Scene, PerspectiveCamera, BufferGeometry, BufferAttribute, Points,
  ShaderMaterial, LineSegments, AdditiveBlending, Color, Vector3, Group,
} from 'three';
