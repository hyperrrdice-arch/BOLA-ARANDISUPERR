"use client";
/**
 * PETA SKOR 3D (brief redesain §9) — renderer Three.js untuk peta
 * peluang skor. Modul ini TIDAK PERNAH diimpor statis: komponen induk
 * memanggil import() hanya dari handler pengguna yang memilih 3D,
 * jadi mesin Three.js tidak masuk muatan awal rute mana pun.
 *
 * Kontrak §9 yang dijaga di sini:
 * - satu InstancedMesh, satu batang per sel bidang 0..4 × 0..4;
 *   tinggi linier terhadap peluang, nol = tinggi nol; skala dari
 *   nilai maksimum seluruh bidang SEBELUM filter;
 * - kamera ortografik; nama tim + angka 0–4 sebagai sprite teks di
 *   lantai grafik; sel terpilih bergaris tepi (bacaannya tertulis di
 *   kepala grafik induk — warna saja tidak cukup);
 * - putar ±32° dalam langkah 16° lewat tombol; ketuk batang (raycast)
 *   memilih sel; grafik diam saat dibuka dan gulir vertikal halaman
 *   tetap jalan (touch-action: pan-y);
 * - DPR ≤ 1,5; render HANYA saat berubah (pilihan/filter/sudut/
 *   ukuran/visibilitas); berhenti saat tab tersembunyi atau grafik
 *   di luar layar; semua sumber daya dilepas saat unmount;
 * - webglcontextlost / WebGL tak tersedia → onGagal, induk kembali
 *   ke tabel 2D dengan sel yang sama.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { BATAS_TAMPIL, selDalamFilter, type FilterPeta } from "@/lib/web/peta-skor";

export interface PropsPeta3D {
  home: string;
  away: string;
  matrix: number[][];
  maksBidang: number;
  filter: FilterPeta;
  terpilih: { h: number; a: number } | null;
  /** Gerak minimum: putaran berubah seketika, tanpa tween. */
  kurangiGerak: boolean;
  onPilih: (h: number, a: number) => void;
  onGagal: () => void;
}

const UKURAN = BATAS_TAMPIL + 1; // 5
const TINGGI_MAKS = 3;
const LANGKAH_PUTAR = Math.PI / 11.25; // 16°
const BATAS_PUTAR = Math.PI / 5.625; // 32°
const EASE = (t: number) => 1 - Math.pow(1 - t, 3); // pendekatan cubic-bezier(.22,.72,.2,1)

const WARNA = {
  lantai: new THREE.Color("#1a332a"),
  batang: new THREE.Color("#8fb996"),
  batangRedup: new THREE.Color("#33503f"),
  terpilih: new THREE.Color("#ff6935"),
  tepi: new THREE.Color("#f8f7f2"),
};

function spriteTeks(teks: string, lebar = 256, tinggi = 128, ukuranFont = 64): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = lebar;
  canvas.height = tinggi;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${ukuranFont}px Archivo, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#c8d6c9";
  ctx.fillText(teks, lebar / 2, tinggi / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(lebar / 128, tinggi / 128, 1);
  return spr;
}

export default function PetaSkor3D(props: PropsPeta3D) {
  const wadahRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const sudutRef = useRef(0);

  useEffect(() => {
    const wadah = wadahRef.current;
    if (!wadah) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      propsRef.current.onGagal();
      return;
    }
    let dilepas = false;
    let rafId = 0;
    let renderTerjadwal = false;
    let terlihat = true;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(new THREE.Color("#142c25"));
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "pan-y";
    wadah.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.1, 100);
    camera.position.set(6.4, 7.2, 6.4);
    camera.lookAt(0, 0.4, 0);

    const grup = new THREE.Group();
    scene.add(grup);

    /* Lantai + kisi */
    const lantai = new THREE.Mesh(
      new THREE.PlaneGeometry(UKURAN + 1.6, UKURAN + 1.6),
      new THREE.MeshBasicMaterial({ color: WARNA.lantai }),
    );
    lantai.rotation.x = -Math.PI / 2;
    lantai.position.y = -0.02;
    grup.add(lantai);
    const kisi = new THREE.GridHelper(UKURAN, UKURAN, 0x3e5c4e, 0x3e5c4e);
    kisi.position.y = 0.001;
    grup.add(kisi);

    /* Batang: satu InstancedMesh; indeks = h * UKURAN + a. */
    const geoBatang = new THREE.BoxGeometry(0.84, 1, 0.84);
    geoBatang.translate(0, 0.5, 0);
    const matBatang = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const batang = new THREE.InstancedMesh(geoBatang, matBatang, UKURAN * UKURAN);
    batang.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grup.add(batang);

    /* Garis tepi sel terpilih. */
    const tepi = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.92, 1, 0.92)),
      new THREE.LineBasicMaterial({ color: WARNA.tepi }),
    );
    tepi.visible = false;
    grup.add(tepi);

    /* Label lantai: angka 0..4 di dua sumbu + nama tim. */
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < UKURAN; i++) {
      const sTamu = spriteTeks(String(i));
      sTamu.position.set(i - 2, 0.02, 2.85);
      sTamu.scale.set(0.5, 0.25, 1);
      grup.add(sTamu);
      sprites.push(sTamu);
      const sKandang = spriteTeks(String(i));
      sKandang.position.set(-2.85, 0.02, i - 2);
      sKandang.scale.set(0.5, 0.25, 1);
      grup.add(sKandang);
      sprites.push(sKandang);
    }
    const namaTamu = spriteTeks(propsRef.current.away, 1024, 128, 58);
    namaTamu.position.set(0, 0.02, 3.6);
    namaTamu.scale.set(4.4, 0.55, 1);
    grup.add(namaTamu);
    sprites.push(namaTamu);
    const namaKandang = spriteTeks(propsRef.current.home, 1024, 128, 58);
    namaKandang.position.set(-3.6, 0.02, 0);
    namaKandang.scale.set(4.4, 0.55, 1);
    grup.add(namaKandang);
    sprites.push(namaKandang);

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const arah = new THREE.DirectionalLight(0xffffff, 1.6);
    arah.position.set(4, 8, 2);
    scene.add(arah);

    const dummy = new THREE.Object3D();
    const warnaSel = new THREE.Color();

    function segarkanBatang() {
      const { matrix, maksBidang, filter, terpilih } = propsRef.current;
      for (let h = 0; h < UKURAN; h++) {
        for (let a = 0; a < UKURAN; a++) {
          const idx = h * UKURAN + a;
          const p = matrix[h]?.[a] ?? 0;
          const tinggi = maksBidang > 0 ? (p / maksBidang) * TINGGI_MAKS : 0;
          dummy.position.set(a - 2, 0, h - 2);
          dummy.scale.set(1, Math.max(tinggi, 0.0001), 1);
          dummy.updateMatrix();
          batang.setMatrixAt(idx, dummy.matrix);
          const dipilih = terpilih !== null && terpilih.h === h && terpilih.a === a;
          if (dipilih) warnaSel.copy(WARNA.terpilih);
          else if (!selDalamFilter(h, a, filter)) warnaSel.copy(WARNA.batangRedup);
          else {
            const t = maksBidang > 0 ? p / maksBidang : 0;
            warnaSel.copy(WARNA.batang).multiplyScalar(0.45 + 0.55 * t);
          }
          batang.setColorAt(idx, warnaSel);
        }
      }
      batang.instanceMatrix.needsUpdate = true;
      if (batang.instanceColor) batang.instanceColor.needsUpdate = true;
      if (terpilih) {
        const p = propsRef.current.matrix[terpilih.h]?.[terpilih.a] ?? 0;
        const tinggi =
          propsRef.current.maksBidang > 0 ? (p / propsRef.current.maksBidang) * TINGGI_MAKS : 0;
        tepi.position.set(terpilih.a - 2, Math.max(tinggi, 0.02) / 2, terpilih.h - 2);
        tepi.scale.set(1, Math.max(tinggi, 0.02), 1);
        tepi.visible = true;
      } else {
        tepi.visible = false;
      }
    }

    function renderSatu() {
      renderTerjadwal = false;
      if (dilepas || !terlihat || document.hidden) return;
      renderer.render(scene, camera);
    }
    function mintaRender() {
      if (renderTerjadwal || dilepas) return;
      renderTerjadwal = true;
      rafId = requestAnimationFrame(renderSatu);
    }

    function sesuaikanUkuran() {
      const w = wadah!.clientWidth || 1;
      const hgt = wadah!.clientHeight || 1;
      renderer.setSize(w, hgt, false);
      const aspek = w / hgt;
      const pandang = 4.6;
      camera.left = -pandang * aspek;
      camera.right = pandang * aspek;
      camera.top = pandang;
      camera.bottom = -pandang;
      camera.updateProjectionMatrix();
      mintaRender();
    }

    segarkanBatang();
    sesuaikanUkuran();

    /* Prop berubah → efek pendamping memancarkan event ini. */
    const onSegarkan = () => {
      segarkanBatang();
      mintaRender();
    };
    wadah.addEventListener("peta-segarkan", onSegarkan);

    const ro = new ResizeObserver(sesuaikanUkuran);
    ro.observe(wadah);
    const io = new IntersectionObserver(
      (entri) => {
        terlihat = entri[0]?.isIntersecting ?? true;
        if (terlihat) mintaRender();
      },
      { threshold: 0.05 },
    );
    io.observe(wadah);
    const onVis = () => {
      if (!document.hidden) mintaRender();
    };
    document.addEventListener("visibilitychange", onVis);

    /* Ketuk batang → pilih sel (geser < 6 px supaya gulir tak memilih). */
    const ray = new THREE.Raycaster();
    const penunjuk = new THREE.Vector2();
    let turun: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      turun = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!turun) return;
      const jauh = Math.hypot(e.clientX - turun.x, e.clientY - turun.y);
      turun = null;
      if (jauh >= 6) return;
      const r = canvas.getBoundingClientRect();
      penunjuk.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(penunjuk, camera);
      const kena = ray.intersectObject(batang);
      const id = kena[0]?.instanceId;
      if (id !== undefined) {
        propsRef.current.onPilih(Math.floor(id / UKURAN), id % UKURAN);
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);

    const onKonteksHilang = (e: Event) => {
      e.preventDefault();
      if (!dilepas) propsRef.current.onGagal();
    };
    canvas.addEventListener("webglcontextlost", onKonteksHilang);

    /* Putaran bertahap — dirender hanya selama tween berjalan. */
    let tweenRaf = 0;
    const putarKe = (target: number, seketika: boolean) => {
      cancelAnimationFrame(tweenRaf);
      if (seketika) {
        grup.rotation.y = target;
        mintaRender();
        return;
      }
      const dari = grup.rotation.y;
      const mulai = performance.now();
      const DURASI = 210;
      const langkah = (t: number) => {
        const k = Math.min(1, (t - mulai) / DURASI);
        grup.rotation.y = dari + (target - dari) * EASE(k);
        mintaRender();
        if (k < 1) tweenRaf = requestAnimationFrame(langkah);
      };
      tweenRaf = requestAnimationFrame(langkah);
    };
    const onPutar = ((e: CustomEvent<{ arah: number }>) => {
      const berikut = THREE.MathUtils.clamp(
        sudutRef.current + e.detail.arah * LANGKAH_PUTAR,
        -BATAS_PUTAR,
        BATAS_PUTAR,
      );
      sudutRef.current = berikut;
      putarKe(berikut, propsRef.current.kurangiGerak);
    }) as EventListener;
    wadah.addEventListener("peta-putar", onPutar);

    return () => {
      dilepas = true;
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(tweenRaf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("webglcontextlost", onKonteksHilang);
      wadah.removeEventListener("peta-segarkan", onSegarkan);
      wadah.removeEventListener("peta-putar", onPutar);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.InstancedMesh) {
          o.geometry?.dispose();
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        }
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Prop berubah (filter/pilihan/matriks) → segarkan + render sekali. */
  useEffect(() => {
    // Segarkan lewat event internal: efek mount memiliki penangan
    // segarkan; cara paling sederhana dan aman adalah memicu render
    // ulang adegan lewat CustomEvent yang didengar efek mount.
    wadahRef.current?.dispatchEvent(new CustomEvent("peta-segarkan"));
  }, [props.filter, props.terpilih, props.matrix]);

  const putar = (arah: number) => {
    wadahRef.current?.dispatchEvent(new CustomEvent("peta-putar", { detail: { arah } }));
  };

  return (
    <div>
      <div
        ref={wadahRef}
        className="h-[320px] w-full sm:h-[380px]"
        role="img"
        aria-label={`Peta skor tiga dimensi ${props.home} melawan ${props.away}. Nilai persis setiap skor dapat dibaca pada pemilih skor dan tabel dua dimensi.`}
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => putar(-1)}
          className="min-h-11 rounded-md border border-gelap-sekunder/50 px-4 text-sm font-medium text-kertas"
        >
          Putar ke kiri
        </button>
        <button
          type="button"
          onClick={() => putar(1)}
          className="min-h-11 rounded-md border border-gelap-sekunder/50 px-4 text-sm font-medium text-kertas"
        >
          Putar ke kanan
        </button>
      </div>
    </div>
  );
}
