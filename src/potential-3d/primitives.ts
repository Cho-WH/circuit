import * as THREE from 'three';

type Primitive =
  | THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial | THREE.LineDashedMaterial>
  | THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
const pools = new WeakMap<THREE.Group, { cursor: number; objects: Primitive[] }>();

/** Retain GPU resources between values; a scene pass updates transforms and attributes. */
export function beginPrimitives(group: THREE.Group) {
  const pool = pools.get(group);
  if (pool) pool.cursor = 0;
  else pools.set(group, { cursor: 0, objects: [] });
}
function obtain<T extends Primitive>(group: THREE.Group, kind: string, create: () => T): T {
  const pool = pools.get(group)!;
  const index = pool.cursor++;
  let object = pool.objects[index];
  if (object?.userData.primitive !== kind) {
    if (object) {
      group.remove(object);
      object.geometry.dispose();
      object.material.dispose();
    }
    object = create();
    object.userData.primitive = kind;
    pool.objects[index] = object;
    group.add(object);
  }
  return object as T;
}
export function endPrimitives(group: THREE.Group) {
  const pool = pools.get(group)!;
  for (const object of pool.objects.splice(pool.cursor)) {
    group.remove(object);
    object.geometry.dispose();
    object.material.dispose();
  }
}
export function line(
  group: THREE.Group,
  points: THREE.Vector3[],
  color: string,
  dashed = false,
  opacity = 1,
) {
  const object = obtain(
    group,
    dashed ? 'dashed' : 'line',
    () =>
      new THREE.Line(
        new THREE.BufferGeometry(),
        dashed
          ? new THREE.LineDashedMaterial({ dashSize: 4, gapSize: 4, transparent: true })
          : new THREE.LineBasicMaterial({ transparent: true }),
      ),
  );
  let positions = object.geometry.getAttribute('position');
  if (!positions || positions.count !== points.length) {
    positions = new THREE.Float32BufferAttribute(points.length * 3, 3);
    object.geometry.setAttribute('position', positions);
  }
  points.forEach((p, i) => positions.setXYZ(i, p.x, p.y, p.z));
  positions.needsUpdate = true;
  object.geometry.computeBoundingSphere();
  object.material.color.set(color);
  object.material.opacity = opacity;
  object.material.depthWrite = true;
  if (dashed) {
    const material = object.material as THREE.LineDashedMaterial;
    material.dashSize = 4;
    material.gapSize = 4;
    let distances = object.geometry.getAttribute('lineDistance');
    if (!distances || distances.count !== points.length) {
      distances = new THREE.Float32BufferAttribute(points.length, 1);
      object.geometry.setAttribute('lineDistance', distances);
    }
    let distance = 0;
    points.forEach((p, i) => {
      if (i) distance += p.distanceTo(points[i - 1]);
      distances.setX(i, distance);
    });
    distances.needsUpdate = true;
  }
  return object;
}
function appearance(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
  color: string,
  visible: boolean,
  id?: string,
) {
  mesh.material.color.set(color);
  if (mesh.material.transparent !== !visible) {
    mesh.material.transparent = !visible;
    // OPAQUE shaders force alpha to 1; recompile when a pooled mesh changes mode.
    mesh.material.needsUpdate = true;
  }
  mesh.material.opacity = visible ? 1 : 0;
  mesh.material.depthWrite = visible;
  mesh.userData.id = id;
}
export function tube(
  group: THREE.Group,
  a: THREE.Vector3,
  b: THREE.Vector3,
  color: string,
  radius: number,
  id: string,
  visible = true,
) {
  const mesh = obtain(
    group,
    'tube',
    () => new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshBasicMaterial()),
  );
  const length = a.distanceTo(b);
  mesh.visible = length > 0.001;
  mesh.scale.set(radius, length, radius);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  if (mesh.visible)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  appearance(mesh, color, visible, id);
}
export function dot(
  group: THREE.Group,
  position: THREE.Vector3,
  color: string,
  radius: number,
  id?: string,
  visible = true,
  netId?: string,
) {
  const mesh = obtain(
    group,
    'dot',
    () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial()),
  );
  mesh.position.copy(position);
  mesh.scale.setScalar(radius);
  appearance(mesh, color, visible, id);
  mesh.userData.netId = netId;
}
