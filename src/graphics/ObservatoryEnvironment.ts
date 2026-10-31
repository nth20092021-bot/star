import * as THREE from 'three';
import { CELESTIAL_CONSTANTS } from '../shared/CosmicTypes';
import { MilkyWaySkyDome } from './MilkyWaySkyDome';
import {
  createBrassTextures,
  createMarbleTexture,
  createZodiacRingTexture,
} from './VisualTextures';
import { clamp, createSeededRandom, damp, disposeObjectTree } from './GraphicsUtils';

interface ArmillaryRing {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  spin: number;
  selfSpin: number;
  baseTiltX: number;
  baseTiltZ: number;
  phase: number;
  wobble: number;
}

const COLUMN_COUNT = 12;
const COLUMN_RADIUS = 44;
const FLOOR_TOP = -20;

/**
 * Đài Thiên Văn Cổ Kính:
 * - Sàn đá cẩm thạch tối màu khắc vòng hoàng đạo phát sáng.
 * - Hàng cột đá bao quanh, đèn sao trên đỉnh cột.
 * - Hệ vòng xoay thiên cầu bằng đồng khổng lồ (Armillary Sphere) nhiều trục.
 * - Vòm trời Milky Way shader + bụi sao lơ lửng.
 */
export class ObservatoryEnvironment {
  public readonly group = new THREE.Group();

  private readonly skyDome: MilkyWaySkyDome;
  private readonly rings: ArmillaryRing[] = [];
  private readonly brassMaterial: THREE.MeshStandardMaterial;
  private readonly zodiacPivot: THREE.Group;
  private readonly zodiacMaterial: THREE.MeshBasicMaterial;
  private readonly axisParent: THREE.Group;
  private readonly centralOrb: THREE.Mesh;
  private readonly moteUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
  };

  private weave = 0;

  constructor(maxAnisotropy = 1) {
    this.group.name = 'ObservatoryEnvironment';

    this.skyDome = new MilkyWaySkyDome(900);
    this.group.add(this.skyDome.group);

    this.addLighting();

    const marbleTexture = createMarbleTexture(maxAnisotropy, 1024);
    const zodiacTexture = createZodiacRingTexture(maxAnisotropy);
    const brassTextures = createBrassTextures(maxAnisotropy);

    this.brassMaterial = new THREE.MeshStandardMaterial({
      name: 'BrassArmillaryMaterial',
      map: brassTextures.map,
      emissiveMap: brassTextures.emissiveMap,
      color: 0xc7a05a,
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color(0xffb15c),
      emissiveIntensity: 0.55,
      envMapIntensity: 1.15,
    });

    this.zodiacMaterial = new THREE.MeshBasicMaterial({
      name: 'ZodiacFloorEngraving',
      map: zodiacTexture,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.createDais(marbleTexture);
    this.createColonnade(marbleTexture);
    this.createArmillarySphere();
    this.axisParent = this.createAxisRod();
    this.centralOrb = this.createCentralOrb();

    const motes = this.createDustMotes();
    this.group.add(motes);

    this.zodiacPivot = this.createZodiacRing();

    this.group.updateMatrixWorld(true);
  }

  /* ------------------------------------------------------------------ */
  /* Ánh sáng                                                            */
  /* ------------------------------------------------------------------ */

  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0x6f8cff, 0x150f1d, 0.85);
    this.group.add(hemisphere);

    const key = new THREE.DirectionalLight(0xffe3bb, 2.1);
    key.position.set(32, 54, 24);
    this.group.add(key);

    const rim = new THREE.DirectionalLight(0x5a7dff, 1.35);
    rim.position.set(-42, 22, -34);
    this.group.add(rim);

    const ember = new THREE.PointLight(0xffa95e, 880, 170, 2);
    ember.position.set(0, 9, 0);
    this.group.add(ember);

    const coolCore = new THREE.PointLight(0x6fa8ff, 620, 190, 2);
    coolCore.position.set(-16, 26, -22);
    this.group.add(coolCore);

    const moon = new THREE.DirectionalLight(0xa8c0ff, 0.55);
    moon.position.set(-20, 60, 40);
    this.group.add(moon);
  }

  /* ------------------------------------------------------------------ */
  /* Sàn đài thiên văn                                                   */
  /* ------------------------------------------------------------------ */

  private createDais(marbleTexture: THREE.Texture): void {
    const floorMaterial = new THREE.MeshStandardMaterial({
      name: 'DarkMarbleFloor',
      map: marbleTexture,
      color: 0xb9c0d6,
      roughness: 0.38,
      metalness: 0.18,
      envMapIntensity: 0.7,
    });

    const stepMaterial = new THREE.MeshStandardMaterial({
      name: 'DarkMarbleStep',
      map: marbleTexture,
      color: 0x757d95,
      roughness: 0.5,
      metalness: 0.14,
    });

    const innerMaterial = new THREE.MeshStandardMaterial({
      name: 'DarkMarbleInnerDais',
      map: marbleTexture,
      color: 0xd2d6e6,
      roughness: 0.34,
      metalness: 0.22,
    });

    const mainFloor = new THREE.Mesh(
      new THREE.CylinderGeometry(52, 54, 2.4, 128, 1),
      floorMaterial
    );
    mainFloor.position.y = FLOOR_TOP - 1.2;
    mainFloor.receiveShadow = false;
    this.group.add(mainFloor);

    const step = new THREE.Mesh(
      new THREE.CylinderGeometry(58, 61, 1.8, 128, 1),
      stepMaterial
    );
    step.position.y = FLOOR_TOP - 3.3;
    this.group.add(step);

    const innerDais = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 31, 0.6, 96, 1),
      innerMaterial
    );
    innerDais.position.y = FLOOR_TOP + 0.0;
    this.group.add(innerDais);

    // Vành đồng khảm quanh sàn
    const inlayMaterial = new THREE.MeshStandardMaterial({
      name: 'FloorBrassInlay',
      color: 0xb08a4a,
      metalness: 0.9,
      roughness: 0.3,
      emissive: new THREE.Color(0xffa64d),
      emissiveIntensity: 0.35,
    });

    const inlay = new THREE.Mesh(new THREE.TorusGeometry(44, 0.17, 8, 220), inlayMaterial);
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = FLOOR_TOP + 0.04;
    this.group.add(inlay);

    const outerInlay = new THREE.Mesh(new THREE.TorusGeometry(50.5, 0.12, 8, 220), inlayMaterial);
    outerInlay.rotation.x = Math.PI / 2;
    outerInlay.position.y = FLOOR_TOP + 0.04;
    this.group.add(outerInlay);
  }

  private createZodiacRing(): THREE.Group {
    const pivot = new THREE.Group();
    pivot.name = 'ZodiacEngraving';
    pivot.position.y = FLOOR_TOP + 0.34;

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), this.zodiacMaterial);
    plane.rotation.x = -Math.PI / 2;
    pivot.add(plane);
    this.group.add(pivot);
    return pivot;
  }

  /* ------------------------------------------------------------------ */
  /* Hàng cột đá                                                         */
  /* ------------------------------------------------------------------ */

  private createColonnade(marbleTexture: THREE.Texture): void {
    const stoneMaterial = new THREE.MeshStandardMaterial({
      name: 'ColonnadeMarble',
      map: marbleTexture,
      color: 0xc6cbdd,
      roughness: 0.45,
      metalness: 0.14,
      envMapIntensity: 0.7,
    });

    const darkMaterial = new THREE.MeshStandardMaterial({
      name: 'ColonnadeDarkStone',
      map: marbleTexture,
      color: 0x848ba1,
      roughness: 0.55,
      metalness: 0.1,
    });

    const lanternMaterial = new THREE.MeshBasicMaterial({
      name: 'ColumnStarLantern',
      color: new THREE.Color(1.65, 1.18, 0.62),
      toneMapped: false,
    });

    const baseGeometry = new THREE.BoxGeometry(4.4, 1.2, 4.4);
    const base2Geometry = new THREE.CylinderGeometry(2.0, 2.5, 0.9, 20);
    const shaftGeometry = new THREE.CylinderGeometry(1.18, 1.4, 15.0, 22, 1);
    const capitalGeometry = new THREE.CylinderGeometry(1.95, 1.32, 1.2, 20);
    const abacusGeometry = new THREE.BoxGeometry(3.6, 0.6, 3.6);
    const bandGeometry = new THREE.TorusGeometry(1.3, 0.07, 8, 44);
    const lanternGeometry = new THREE.SphereGeometry(0.3, 16, 12);

    const bandMaterial = new THREE.MeshStandardMaterial({
      name: 'ColumnGlowBand',
      color: 0xc9a45f,
      metalness: 0.88,
      roughness: 0.3,
      emissive: new THREE.Color(0xffb45e),
      emissiveIntensity: 0.6,
    });

    for (let i = 0; i < COLUMN_COUNT; i += 1) {
      const angle = (i / COLUMN_COUNT) * Math.PI * 2;
      const column = new THREE.Group();
      column.position.set(
        Math.cos(angle) * COLUMN_RADIUS,
        FLOOR_TOP,
        Math.sin(angle) * COLUMN_RADIUS
      );
      column.rotation.y = -angle;

      const base = new THREE.Mesh(baseGeometry, darkMaterial);
      base.position.y = 0.6;
      column.add(base);

      const base2 = new THREE.Mesh(base2Geometry, stoneMaterial);
      base2.position.y = 1.65;
      column.add(base2);

      const shaft = new THREE.Mesh(shaftGeometry, stoneMaterial);
      shaft.position.y = 9.6;
      column.add(shaft);

      const band = new THREE.Mesh(bandGeometry, bandMaterial);
      band.rotation.x = Math.PI / 2;
      band.position.y = 15.6;
      column.add(band);

      const capital = new THREE.Mesh(capitalGeometry, stoneMaterial);
      capital.position.y = 18.2;
      column.add(capital);

      const abacus = new THREE.Mesh(abacusGeometry, darkMaterial);
      abacus.position.y = 19.1;
      column.add(abacus);

      const lantern = new THREE.Mesh(lanternGeometry, lanternMaterial);
      lantern.position.y = 19.75;
      column.add(lantern);

      this.group.add(column);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Vòng xoay thiên cầu bằng đồng                                       */
  /* ------------------------------------------------------------------ */

  private createArmillarySphere(): void {
    const radius = CELESTIAL_CONSTANTS.ARMILLARY_RADIUS;
    const center = new THREE.Vector3(0, -1, 0);

    const armillary = new THREE.Group();
    armillary.name = 'BrassArmillarySphere';
    armillary.position.copy(center);
    this.group.add(armillary);

    const specs: Array<{
      radius: number;
      tube: number;
      tiltX: number;
      tiltZ: number;
      spin: number;
      selfSpin: number;
      wobble: number;
    }> = [
      { radius: radius - 0.4, tube: 0.5, tiltX: Math.PI / 2, tiltZ: 0, spin: 0.055, selfSpin: 0.12, wobble: 0.09 },
      { radius: radius - 1.0, tube: 0.56, tiltX: 0.0, tiltZ: 0.0, spin: -0.042, selfSpin: -0.09, wobble: 0.07 },
      { radius: radius - 2.2, tube: 0.68, tiltX: THREE.MathUtils.degToRad(23.4), tiltZ: 0.18, spin: 0.075, selfSpin: 0.16, wobble: 0.11 },
      { radius: radius - 4.2, tube: 0.45, tiltX: 0.52, tiltZ: 0.72, spin: -0.098, selfSpin: -0.14, wobble: 0.08 },
      { radius: radius - 6.6, tube: 0.34, tiltX: -0.72, tiltZ: 0.44, spin: 0.13, selfSpin: 0.2, wobble: 0.12 },
      { radius: radius + 0.35, tube: 0.17, tiltX: 1.18, tiltZ: 0.28, spin: 0.035, selfSpin: 0.06, wobble: 0.05 },
    ];

    const studGeometry = new THREE.SphereGeometry(0.34, 14, 10);
    const studMaterial = new THREE.MeshStandardMaterial({
      name: 'ArmillaryStud',
      color: 0xe0bb79,
      metalness: 0.95,
      roughness: 0.2,
      emissive: new THREE.Color(0xffb766),
      emissiveIntensity: 0.35,
    });

    specs.forEach((spec, index) => {
      const pivot = new THREE.Group();
      pivot.rotation.set(spec.tiltX, (index / specs.length) * Math.PI, spec.tiltZ);
      armillary.add(pivot);

      const geometry = new THREE.TorusGeometry(
        spec.radius,
        spec.tube,
        16,
        spec.radius > 32 ? 280 : 220
      );
      const ringMesh = new THREE.Mesh(geometry, this.brassMaterial);
      ringMesh.rotation.z = index * 0.9;
      pivot.add(ringMesh);

      if (index === 0 || index === 2) {
        for (let s = 0; s < 4; s += 1) {
          const angle = (s / 4) * Math.PI * 2 + index * 0.6;
          const stud = new THREE.Mesh(studGeometry, studMaterial);
          stud.position.set(Math.cos(angle) * spec.radius, Math.sin(angle) * spec.radius, 0);
          ringMesh.add(stud);
        }
      }

      this.rings.push({
        pivot,
        mesh: ringMesh,
        spin: spec.spin,
        selfSpin: spec.selfSpin,
        baseTiltX: spec.tiltX,
        baseTiltZ: spec.tiltZ,
        phase: index * 1.37,
        wobble: spec.wobble,
      });
    });

    const glowRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 2.4, 0.08, 8, 240),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 0.82, 1.0),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.y = 0.2;
    armillary.add(glowRing);
  }

  private createAxisRod(): THREE.Group {
    const parent = new THREE.Group();
    parent.name = 'ArmillaryAxis';
    parent.position.set(0, -1, 0);
    this.group.add(parent);

    const axisDirection = new THREE.Vector3(0.28, 0.72, 0.63).normalize();
    const axis = new THREE.Group();
    axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDirection);
    parent.add(axis);

    const rodMaterial = new THREE.MeshStandardMaterial({
      name: 'ArmillaryAxisBrass',
      color: 0x9a7a3f,
      metalness: 0.94,
      roughness: 0.32,
      emissive: new THREE.Color(0xff9f45),
      emissiveIntensity: 0.18,
    });

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 77, 10, 1), rodMaterial);
    axis.add(rod);

    const finialGeometry = new THREE.SphereGeometry(0.48, 14, 10);
    for (const direction of [1, -1]) {
      const finial = new THREE.Mesh(finialGeometry, this.brassMaterial);
      finial.position.y = direction * 38.5;
      axis.add(finial);
    }

    return parent;
  }

  private createCentralOrb(): THREE.Mesh {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 28, 20),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.45, 0.98, 0.5),
        toneMapped: false,
      })
    );
    orb.name = 'CentralSunOrb';
    orb.position.set(0, -1, 0);
    this.group.add(orb);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 24, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.38, 0.21, 0.08),
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    orb.add(halo);

    return orb;
  }

  /* ------------------------------------------------------------------ */
  /* Bụi sao lơ lửng                                                     */
  /* ------------------------------------------------------------------ */

  private createDustMotes(): THREE.Points {
    const count = 230;
    const rand = createSeededRandom(0x5eed42);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const radius = 7 + rand() * 36;
      const angle = rand() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = FLOOR_TOP + 1 + rand() * 34;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      sizes[i] = 0.35 + rand() * 1.0;
      seeds[i] = rand();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: this.moteUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aSeed;

        uniform float uTime;
        uniform float uPixelRatio;

        varying float vSeed;
        varying float vFade;

        void main() {
          vec3 pos = position;
          pos.y += sin(uTime * 0.17 + aSeed * 6.2831) * 1.4;
          pos.x += sin(uTime * 0.1 + aSeed * 11.0) * 0.8;
          pos.z += cos(uTime * 0.12 + aSeed * 8.0) * 0.8;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uPixelRatio * (130.0 / max(-mvPosition.z, 1.0)), 1.0, 8.0);

          vSeed = aSeed;
          vFade = smoothstep(150.0, 20.0, -mvPosition.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;

        varying float vSeed;
        varying float vFade;

        void main() {
          float d = length(gl_PointCoord - 0.5);
          float alpha = smoothstep(0.5, 0.0, d);
          alpha *= vFade * (0.12 + 0.16 * abs(sin(uTime * 0.55 + vSeed * 20.0)));
          vec3 color = mix(vec3(0.68, 0.82, 1.0), vec3(1.0, 0.8, 0.5), vSeed);
          gl_FragColor = vec4(color * 1.4, alpha);
        }
      `,
    });

    const points = new THREE.Points(geometry, material);
    points.name = 'ObservatoryStarDust';
    points.frustumCulled = false;
    return points;
  }

  /* ------------------------------------------------------------------ */
  /* Vòng đời                                                            */
  /* ------------------------------------------------------------------ */

  public setPixelRatio(pixelRatio: number): void {
    this.moteUniforms.uPixelRatio.value = Math.max(1, pixelRatio);
    this.skyDome.setPixelRatio(pixelRatio);
  }

  public update(dt: number, elapsed: number, weaveIntensity: number): void {
    this.weave = damp(this.weave, clamp(weaveIntensity, 0, 1), 1.8, dt);
    const speed = 1 + this.weave * 1.7;

    for (const ring of this.rings) {
      ring.pivot.rotation.y += ring.spin * dt * speed;
      ring.pivot.rotation.x =
        ring.baseTiltX + Math.sin(elapsed * ring.wobble + ring.phase) * 0.045;
      ring.pivot.rotation.z =
        ring.baseTiltZ + Math.cos(elapsed * ring.wobble * 0.8 + ring.phase) * 0.035;
      ring.mesh.rotation.z += ring.selfSpin * dt * speed;
    }

    this.axisParent.rotation.y += dt * 0.018 * speed;
    this.zodiacPivot.rotation.y = elapsed * 0.022 * (1 + this.weave * 0.6);
    this.zodiacMaterial.opacity = 0.66 + 0.1 * Math.sin(elapsed * 0.7) + this.weave * 0.14;

    this.brassMaterial.emissiveIntensity = 0.38 + 0.08 * Math.sin(elapsed * 0.9) + this.weave * 0.3;

    const orbPulse = 1 + Math.sin(elapsed * 1.2) * 0.05 + this.weave * 0.1;
    this.centralOrb.scale.setScalar(orbPulse);

    this.skyDome.update(elapsed, dt);
    this.moteUniforms.uTime.value = elapsed;
  }

  public dispose(): void {
    disposeObjectTree(this.group);
  }
}
