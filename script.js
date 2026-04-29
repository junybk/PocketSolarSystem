/**
 * Hand sized Universe - メインアプリケーションファイル
 *
 * マウス・タッチで操作する3D太陽系シミュレーション
 *
 * 主な機能:
 * - ドラッグ: カメラ回転（太陽系全体視点時）
 * - ホイール / ピンチ: ズーム
 * - ホバー（マウス）またはタップ: 天体の説明
 * - 2つのカメラモード: 太陽系全体視点と地球視点
 *
 * @fileoverview 太陽系シミュレーションのメインロジック
 * @version 1.0
 */

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * アプリケーション設定
 * @property {number} cameraSmooth - カメラ回転の補間係数（0-1、小さいほど滑らか）
 * @property {number} zoomSmooth - ズームの補間係数（0-1、小さいほど滑らか）
 * @property {number} minZoom - 最小ズーム距離（カメラの最小Z座標）
 * @property {number} maxZoom - 最大ズーム距離（冥王星まで見えるように設定）
 * @property {number} starCount - 背景に表示する星の数
 * @property {number} planetEmissiveIntensity - 惑星の自発光強度（0.0-1.0、太陽とは別）
 */
const SETTINGS = {
    cameraSmooth: 0.05,
    zoomSmooth: 0.1,
    minZoom: 10,
    maxZoom: 1000,
    starCount: 10000, //背景に表示する星の数
    planetEmissiveIntensity: 0.1
};

// ========================================
// Three.js シーン関連のグローバル変数
// ========================================
let scene;                    // Three.jsシーン（3D空間のコンテナ）
let renderer;                 // WebGLレンダラー（3D描画用）
let solarCamera;              // 太陽系全体視点カメラ（orbitGroupの子要素、回転の影響を受ける）
let earthCamera;              // 地球視点カメラ（sceneに直接追加、orbitGroupの影響を受けない）
let activeCamera;             // 現在使用中のカメラ（solarCameraまたはearthCamera）
let labelRenderer;            // CSS2Dラベル用レンダラー（HTMLラベル表示用）
let orbitGroup;               // カメラ回転用のグループ（太陽系全体カメラのみが子要素）

// ========================================
// ポインター操作（マウス・タッチ）
// ========================================
let containerElement = null;
const activePointers = new Map();
let dragPointerId = null;
let dragLastX = 0;
let dragLastY = 0;
let dragStartX = 0;
let dragStartY = 0;
let didDrag = false;
let pinchLastDistance = 0;
const DRAG_THRESHOLD_PX = 10;
const ROTATION_SENSITIVITY = 0.0035;
const WHEEL_ZOOM_FACTOR = 0.08;

// ========================================
// 太陽系オブジェクト関連のグローバル変数
// ========================================
const planets = [];     // 惑星オブジェクトの配列（各惑星のメッシュ、軌道、速度などの情報を含む）
let sunMesh;            // 太陽のメッシュオブジェクト
let sunTexture;          // 太陽のテクスチャ
let stars;               // 背景の星（Pointsオブジェクト、GPUシェーダーで瞬きアニメーション）

// ========================================
// 地球視点カメラの可視化用マーカー
// ========================================

// ========================================
// UI状態管理
// ========================================
let labelsVisible = true;                // ラベルの表示/非表示フラグ
const labels = [];                       // すべてのラベルを保持（表示/非表示切り替え用）

// ========================================
// ユーティリティ
// ========================================
const textureLoader = new THREE.TextureLoader();  // テクスチャ読み込み用ローダー

// ========================================
// カメラ操作の補間用（目標値と現在値）
// スムーズなカメラ移動のため、目標値と現在値を分離して線形補間
// ========================================
const targetRotation = { x: 0, y: 0 };   // カメラ回転の目標値
const currentRotation = { x: 0, y: 0 }; // カメラ回転の現在値（補間により更新）
let targetZoom = 60;                      // ズームの目標値
let currentZoom = 60;                     // ズームの現在値（補間により更新）

// ========================================
// カメラモード管理
// ========================================
let cameraMode = 'solar';                 // カメラモード: 'solar'（太陽系全体）または 'earth'（地球視点）
let earthPlanet = null;                   // 地球の惑星オブジェクトへの参照（地球視点カメラ計算用）

// ========================================
// 天体選択（レイキャスト）
// ========================================
let raycaster = new THREE.Raycaster();              // レイキャスティング用（画面座標から惑星を検出）
let selectedPlanet = null;                          // 現在選択されている星（説明が表示されている星）
let highlightedPlanet = null;                       // 現在ハイライトされている星のメッシュ（視覚的フィードバック）
let hoveringStartTime = 0;                         // ホバー開始時刻（説明表示のタイミング計算用）
let hoveringTargetPlanet = null;                   // ホバー中の天体名（同じ天体の上に留まっているか判定）
const HOVERING_DURATION = 500;                     // 説明を表示するまでの時間（ミリ秒、ホバーで同じ天体の上に留まる必要がある）
let infoPanelTimer = null;                         // 説明パネルを自動的に非表示にするタイマー
const INFO_PANEL_AUTO_HIDE_DURATION = 30000;        // 説明パネルを自動的に非表示にするまでの時間（ミリ秒、30秒）

/** サイドメニューで選択中の天体をカメラ中央に追従（太陽系視点時のみ） */
let focusTrackingName = null;
const _focusWorldPos = new THREE.Vector3();
const _focusDir = new THREE.Vector3();
const _focusQuat = new THREE.Quaternion();
const _focusEuler = new THREE.Euler();
const _focusCamWorld = new THREE.Vector3();

/**
 * 左メニューに表示する天体 ID（planetInfo / 3D オブジェクトと対応）
 */
const SIDEBAR_BODY_IDS = [
    'Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
    'Moon', 'ISS'
];

// ========================================
// 星の説明データ
// diameterKm / avgDistanceFromSunKm / avgDistanceAU / rotationSummary / highlights
// ========================================
const planetInfo = {
    Sun: {
        name: "太陽 (Sun)",
        diameterKm: 1392000,
        avgDistanceFromSunKm: null,
        avgDistanceAU: null,
        rotationSummary: "あり（差別自転：赤道付近で約25日、極付近で約35日）",
        highlights: "核融合によるエネルギー源／太陽系の重力の中心",
        description: "太陽系の中心にある恒星。表面の可視光に相当する温度は約5,500℃、中心部は約1,500万℃に達します。水素の核融合により光と熱を放射し、その重力が惑星の公転を支配しています。表面はガス状で、黒点やフレアなどの活動を繰り返します。"
    },
    Mercury: {
        name: "水星 (Mercury)",
        diameterKm: 4879,
        avgDistanceFromSunKm: 57900000,
        avgDistanceAU: 0.387,
        rotationSummary: "あり（3:2の自転共振／太陽に対して1周するのに自転は約1.5周）",
        highlights: "太陽系最小の惑星／ほぼ大気なし／昼夜の極端な温度差",
        description: "太陽に最も近い惑星で、大気が極めて薄いため昼は約430℃、夜は約-180℃と極端な温度差があります。クレーターが密な表面は、太古からあまり変わっていない様子を示しています。太陽の潮汐力により、自転と公転が3:2の共振関係にあります。"
    },
    Venus: {
        name: "金星 (Venus)",
        diameterKm: 12104,
        avgDistanceFromSunKm: 108200000,
        avgDistanceAU: 0.723,
        rotationSummary: "あり（逆行／約243地球日で1回転し、公転周期より長い）",
        highlights: "超高温の濃厚CO₂大気／強い温室効果／雷雲や硫酸雲",
        description: "地球とほぼ同じ直径を持ちながら、厚い二酸化炭素大気と硫酸を含む雲に覆われ、表面は約470℃に達します。自転は他の惑星と逆向きで、1金星日は約243地球日と長く、太陽の見え方も独特です。過去の探査で地表のクレーターや火山地形が明らかになっています。"
    },
    Earth: {
        name: "地球 (Earth)",
        diameterKm: 12756,
        avgDistanceFromSunKm: 149600000,
        avgDistanceAU: 1.0,
        rotationSummary: "あり（恒星日 約23時間56分／赤道で約1,670 km/h）",
        highlights: "液体の水と酸素豊富な大気／生命の存在が確認されている唯一の天体",
        description: "太陽からの距離と大気の組み合わせにより、表面に液体の水が安定して存在します。窒素主体の大気と酸素は生命によっても維持され、海・大陸・氷床が共存する活動的な惑星です。月の潮汐力や地軸の傾きが季節や潮汐に深く関わっています。"
    },
    Mars: {
        name: "火星 (Mars)",
        diameterKm: 6792,
        avgDistanceFromSunKm: 227900000,
        avgDistanceAU: 1.524,
        rotationSummary: "あり（約24時間37分で1回転／地球に近い日の長さ）",
        highlights: "酸化鉄による赤い地表／古代の河川痕／極冠の二酸化炭素と水氷",
        description: "地球の約半分の直径で、薄い二酸化炭素大気の下に広がる赤色は酸化鉄によるものです。かつて水が流れた地形や湖床の痕跡が多数見つかっており、微生物の痕跡を探す探査が続けられています。衛星はフォボスとダイモスの2つで、どちらも小さな不規則な天体です。"
    },
    Jupiter: {
        name: "木星 (Jupiter)",
        diameterKm: 142984,
        avgDistanceFromSunKm: 778500000,
        avgDistanceAU: 5.203,
        rotationSummary: "あり（約9時間55分で1回転／太陽系で最も速い自転の一つ）",
        highlights: "巨大ガス惑星／縞模様と大赤斑／強い磁場と多数の衛星",
        description: "主に水素とヘリウムから成る太陽系最大の惑星で、明るい縞は大気のジェット流、大赤斑は巨大な渦巻き嵐です。ガニメデ、イオ、エウロパ、カリストなど多様な衛星を抱え、木星の磁気圏は太陽風にさらされる衛星の環境にも大きく影響します。"
    },
    Saturn: {
        name: "土星 (Saturn)",
        diameterKm: 120536,
        avgDistanceFromSunKm: 1432000000,
        avgDistanceAU: 9.537,
        rotationSummary: "あり（約10時間33分で1回転／木星に次ぐ高速自転）",
        highlights: "壮観な氷・岩石の輪／水より小さい平均密度／タイタンをはじめとする衛星",
        description: "水素・ヘリウム主体のガス惑星で、氷と岩石の粒子からなる輪系が太陽系で最も華やかです。平均密度は水より小さく、内部では金属水素の層が強い磁場を生みます。衛星タイタンは厚い大気とメタンサイクルを持ち、探査の焦点となっています。"
    },
    Uranus: {
        name: "天王星 (Uranus)",
        diameterKm: 51118,
        avgDistanceFromSunKm: 2867000000,
        avgDistanceAU: 19.19,
        rotationSummary: "あり（約17時間で1回転／自転軸が公転軌道に対し約98°と横倒し）",
        highlights: "氷巨大惑星／メタンによる青緑色／極付近に長い昼夜",
        description: "水・メタン・アンモニアを主とする「氷」成分に分類される巨大惑星で、大気中のメタンが赤い光を吸収し青緑に見えます。自転軸がほぼ公転面に寝ており、公転の途中で極に長い夏・冬が訪れます。細く暗い輪と多数の衛星を持ちます。"
    },
    Neptune: {
        name: "海王星 (Neptune)",
        diameterKm: 49244,
        avgDistanceFromSunKm: 4515000000,
        avgDistanceAU: 30.07,
        rotationSummary: "あり（約16時間で1回転／高速のジェットと大暗斑）",
        highlights: "太陽系最外縁の巨大惑星／強風／トリトンの逆行衛星",
        description: "メタンなどにより青く見える氷巨大惑星で、観測された風速は太陽系内でも突出しています。大暗斑は木星の大赤斑に似た巨大な嵐でしたが、数年単位で形が変化します。最大の衛星トリトンは海王星を逆行公転しており、捕獲された天体と考えられています。"
    },
    Pluto: {
        name: "冥王星 (Pluto)",
        diameterKm: 2376,
        avgDistanceFromSunKm: 5906000000,
        avgDistanceAU: 39.48,
        rotationSummary: "あり（約6.39地球日で1回転／カロンと潮汐的に強く結びつく）",
        highlights: "準惑星／心臓型の平原トンボ／窒素の氷と山岳地形",
        description: "2006年に準惑星に再分類されましたが、多様な地形を持つ小さな世界です。広いスプートニク平原は若い窒素の氷の平原と考えられ、近くには水氷の山々がそびえます。衛星カロンは直径が大きく、二重天体に近い関係にあります。"
    },
    Moon: {
        name: "月 (Moon)",
        diameterKm: 3474,
        avgDistanceFromSunKm: 149600000,
        avgDistanceAU: 1.0,
        extraOrbitNote: "地球からの平均距離 約384,400 km（公転・自転が同期）",
        rotationSummary: "あり（潮汐ロック：公転周期と自転周期がほぼ一致）",
        highlights: "クレーターだらけの古老な表面／地球の潮汐に支配的な影響",
        description: "地球の唯一の衛星で、形成初期の激しい衝突史をクレーターが記録しています。地球から見える見かけの大きさは偶然にも太陽と近く、日食で太陽をほぼ隠せるほどです。極域の永久影のクレーターでは水氷が探査されています。"
    },
    ISS: {
        name: "国際宇宙ステーション (ISS)",
        diameterText: "本体桁 約110 m（太陽電池含む最大幅 約73 m 級）",
        avgDistanceFromSunKm: 149600000,
        avgDistanceAU: 1.0,
        extraOrbitNote: "地表からの高度 約400 km（地球周回、約92分で1周）",
        rotationSummary: "あり（地球周回に同期した姿勢制御／1軌道約92分）",
        highlights: "常時有人の研究基地／国際協力による組み立てと運用",
        description: "複数の国が参加して建造した大型の有人施設で、微小重力環境での科学実験、地球観測、宇宙医学などが行われています。軌道高度は大気抵抗によりわずかに低下し、定期的に再点火で高度を維持しています。"
    }
};

/**
 * 説明文以外の HTML 用に文字列をエスケープ
 */
function escapeHtmlPlanet(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 数値を桁区切りで表示（km）
 */
function formatKmValue(n) {
    return Number(n).toLocaleString('ja-JP');
}

/**
 * 天体詳細パネル用 HTML を組み立てる
 */
function buildPlanetInfoContentHtml(info) {
    const facts = [];

    if (info.diameterKm != null) {
        facts.push(
            `<div class="planet-fact-row"><span class="planet-fact-label">直径</span><span class="planet-fact-value">${formatKmValue(info.diameterKm)} km</span></div>`
        );
    } else if (info.diameterText) {
        facts.push(
            `<div class="planet-fact-row"><span class="planet-fact-label">サイズ</span><span class="planet-fact-value">${escapeHtmlPlanet(info.diameterText)}</span></div>`
        );
    }

    if (info.avgDistanceFromSunKm != null && info.avgDistanceAU != null) {
        facts.push(
            `<div class="planet-fact-row"><span class="planet-fact-label">太陽からの平均距離</span><span class="planet-fact-value">${formatKmValue(info.avgDistanceFromSunKm)} km（約 ${info.avgDistanceAU} AU）</span></div>`
        );
    } else if (info.avgDistanceFromSunKm === null && info.name && info.name.includes('太陽')) {
        facts.push(
            `<div class="planet-fact-row"><span class="planet-fact-label">太陽からの平均距離</span><span class="planet-fact-value">—（基準天体）</span></div>`
        );
    }

    if (info.extraOrbitNote) {
        facts.push(
            `<div class="planet-fact-row planet-fact-row-sub"><span class="planet-fact-label">軌道・備考</span><span class="planet-fact-value">${escapeHtmlPlanet(info.extraOrbitNote)}</span></div>`
        );
    }

    facts.push(
        `<div class="planet-fact-row"><span class="planet-fact-label">自転</span><span class="planet-fact-value">${escapeHtmlPlanet(info.rotationSummary)}</span></div>`
    );

    facts.push(
        `<div class="planet-fact-row planet-fact-highlight"><span class="planet-fact-label">代表的な特徴</span><span class="planet-fact-value">${escapeHtmlPlanet(info.highlights)}</span></div>`
    );

    const factsBlock = `<div class="planet-facts-grid">${facts.join('')}</div>`;
    const descBlock = `<p class="planet-description">${escapeHtmlPlanet(info.description)}</p>`;
    return factsBlock + descBlock;
}

// ========================================
// アプリケーションの起動
// ========================================
init();

/**
 * アプリケーションの初期化
 * 
 * アプリケーション全体の初期化を行う。以下の処理を順番に実行する:
 * 1. Three.jsシーンの構築（カメラ、レンダラー、ライト）
 * 2. 太陽系の作成（太陽、惑星、軌道、ISS、月）
 * 3. 背景の星の生成
 * 4. マウス・タッチ操作の登録
 * 5. アニメーションループの開始
 * 6. イベントリスナーの登録（ウィンドウリサイズ、UIボタンなど）
 */
function init() {
    setupScene();
    createSolarSystem();
    setupStars();

    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    setupPointerControls();

    setupPlanetMenu();

    requestAnimationFrame(() => onWindowResize());

    animate();

    window.addEventListener('resize', onWindowResize);

    const labelToggleButton = document.getElementById('label-toggle');
    if (labelToggleButton) {
        labelToggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLabels();
        });
    } else {
        console.error('Label toggle button not found');
    }

    const closeButton = document.getElementById('planet-info-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            hidePlanetInfo();
        });
    }

    setupMobileMenuToggle();
}

function setupMobileMenuToggle() {
    const sideMenu = document.getElementById('side-menu');
    const toggleButton = document.getElementById('side-menu-toggle');
    const toggleIcon = toggleButton ? toggleButton.querySelector('.material-symbols-outlined') : null;
    if (!sideMenu || !toggleButton) return;

    const mobileQuery = window.matchMedia('(max-width: 760px)');

    const syncMobileMenuState = () => {
        const isMobile = mobileQuery.matches;
        if (!isMobile) {
            sideMenu.classList.remove('menu-collapsed');
            toggleButton.setAttribute('aria-expanded', 'true');
            toggleButton.setAttribute('aria-label', 'メニューを閉じる');
            if (toggleIcon) toggleIcon.textContent = 'close';
            return;
        }

        if (!sideMenu.classList.contains('menu-collapsed')) {
            sideMenu.classList.add('menu-collapsed');
        }
        toggleButton.setAttribute('aria-expanded', 'false');
        toggleButton.setAttribute('aria-label', 'メニューを開く');
        if (toggleIcon) toggleIcon.textContent = 'menu';
    };

    toggleButton.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!mobileQuery.matches) return;
        sideMenu.classList.toggle('menu-collapsed');
        const expanded = !sideMenu.classList.contains('menu-collapsed');
        toggleButton.setAttribute('aria-expanded', expanded.toString());
        toggleButton.setAttribute('aria-label', expanded ? 'メニューを閉じる' : 'メニューを開く');
        if (toggleIcon) toggleIcon.textContent = expanded ? 'close' : 'menu';
    });

    if (mobileQuery.addEventListener) {
        mobileQuery.addEventListener('change', syncMobileMenuState);
    } else if (mobileQuery.addListener) {
        mobileQuery.addListener(syncMobileMenuState);
    }
    syncMobileMenuState();
}


// ========================================
// シーン構築関連の関数
// ========================================

/**
 * Three.jsシーンの構築
 * 
 * 3Dシーンの基本設定を行う。以下の要素を設定する:
 * - シーン（3D空間のコンテナ）
 * - カメラ（太陽系全体視点と地球視点の2つ）
 * - レンダラー（WebGLとCSS2D）
 * - ライト（環境光と点光源）
 * 
 * カメラの構造:
 * - solarCamera: orbitGroupの子要素として配置（回転の影響を受ける）
 * - earthCamera: sceneに直接追加（orbitGroupの影響を受けない）
 * 
 * @see orbitGroup - カメラ回転用のグループ
 */
function setupScene() {
    const container = document.getElementById('canvas-container');
    const vw = container.clientWidth || window.innerWidth;
    const vh = container.clientHeight || window.innerHeight;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002); // 遠方のオブジェクトをフェードアウト

    // 太陽系全体視点カメラ（orbitGroupの子要素として追加、回転の影響を受ける）
    solarCamera = new THREE.PerspectiveCamera(60, vw / vh, 0.1, 1000);
    solarCamera.position.set(0, 0, 60);
    solarCamera.lookAt(0, 0, 0);

    // 地球視点カメラ（sceneに直接追加、orbitGroupの影響を受けない）
    // nearを0.001に設定することで、地球の表面近くでも描画可能
    earthCamera = new THREE.PerspectiveCamera(60, vw / vh, 0.001, 1000);

    // カメラ回転用のグループ（太陽系全体カメラのみが子要素）
    const cameraRig = new THREE.Group();
    cameraRig.add(solarCamera);
    scene.add(cameraRig);
    orbitGroup = cameraRig;

    // 地球視点カメラはorbitGroupの影響を受けないよう、sceneに直接追加
    scene.add(earthCamera);

    activeCamera = solarCamera;

    // WebGLレンダラー（3D描画用）
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(vw, vh);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 高DPIディスプレイ対応（最大2倍まで）
    container.appendChild(renderer.domElement);

    // CSS2Dレンダラー（ラベル表示用）
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(vw, vh);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none'; // ラベルがマウスイベントを妨げないように
    container.appendChild(labelRenderer.domElement);

    // 環境光（全体を薄く照らす）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.012);
    scene.add(ambientLight);

    // 点光源（太陽の位置に配置、惑星を照らす）
    // 近距離の白飛びを抑えつつ外惑星も照らすため、減衰を無効化して強度を調整
    const pointLight = new THREE.PointLight(0xffffff, 2.2, 0);
    pointLight.decay = 0;
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);
}

// ========================================
// 太陽系オブジェクト作成関連の関数
// ========================================

/**
 * 太陽系の作成
 * 
 * 太陽、惑星、軌道、ISS、月を生成する。
 * 各惑星は以下の階層構造で作成される:
 * - systemGroup: 昇交点黄経の回転を適用
 *   - inclinedGroup: 軌道傾斜角を適用
 *     - orbit: 軌道線（リング）
 *     - pivot: 公転用のピボットグループ
 *       - mesh: 惑星本体（自転軸の傾きを適用）
 *       - ringMesh: 土星の輪（土星のみ）
 *       - moonOrbit: 月の軌道（地球のみ）
 *       - issOrbit: ISSの軌道（地球のみ）
 * 
 * 各惑星にはuserData.planetNameが設定され、レイキャスティングで
 * 識別できるようになっている。
 * 
 * @see planetData - 惑星のデータ配列（半径、距離、速度など）
 */
function createSolarSystem() {
    const getLabelOffsetByRadius = (radius, extra = 0) => {
        const base = Math.max(radius * 1.12, 0.22);
        const padding = THREE.MathUtils.clamp(radius * 0.16 + 0.18, 0.22, 1.1);
        return base + padding + extra;
    };

    // 太陽の作成
    const sunGeometry = new THREE.SphereGeometry(5, 24, 24);
    sunTexture = textureLoader.load("assets/sun.jpg", undefined, undefined, (err) => {
        console.error('Failed to load sun texture', err);
    });
    const sunMaterial = createPlanetMaterial(sunTexture, { lit: false });
    sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    scene.add(sunMesh);

    const sunLabel = createLabel('Sun', getLabelOffsetByRadius(5));
    sunMesh.add(sunLabel);

    /**
     * 惑星データ
     * @property {string} name - 惑星名
     * @property {number} r - 半径（地球を1.0とした相対値）
     * @property {number} dist - 軌道距離（地球を1.0とした相対値）
     * @property {number} speed - 公転速度（大きいほど速い）
     * @property {number} inclination - 軌道傾斜角（度）
     * @property {number} node - 昇交点黄経（度）
     * @property {number} obliquity - 自転軸の傾き（度）
     * @property {boolean} retrograde - 逆回転フラグ（trueの場合、自転が逆方向）
     * @property {number} rotationSpeed - 自転速度（地球を1.0とした相対値）
     * @property {string} textureUrl - テクスチャ画像のパス
     * @property {boolean} ring - 輪があるかどうか（土星のみ）
     */
    const planetData = [
        { name: "Mercury", r: 0.38, dist: 7.8, speed: 0.04, inclination: 7.0, node: 48, obliquity: 0.03, retrograde: false, rotationSpeed: 0.017, textureUrl: "assets/mercury.jpg" },
        { name: "Venus", r: 0.95, dist: 14.4, speed: 0.03, inclination: 3.4, node: 76, obliquity: 177.4, retrograde: true, rotationSpeed: 0.004, textureUrl: "assets/venus.jpg" },
        { name: "Earth", r: 1.0, dist: 20, speed: 0.025, inclination: 0.0, node: 0, obliquity: 23.4, retrograde: false, rotationSpeed: 1.0, textureUrl: "assets/earth.jpg" },
        { name: "Mars", r: 0.53, dist: 30.4, speed: 0.02, inclination: 1.9, node: 49, obliquity: 25.2, retrograde: false, rotationSpeed: 0.97, textureUrl: "assets/mars.jpg" },
        { name: "Jupiter", r: 11.2, dist: 104, speed: 0.01, inclination: 1.3, node: 100, obliquity: 3.1, retrograde: false, rotationSpeed: 2.44, textureUrl: "assets/jupiter.jpg" },
        { name: "Saturn", r: 9.4, dist: 191, speed: 0.008, ring: true, inclination: 2.5, node: 113, obliquity: 26.7, retrograde: false, rotationSpeed: 2.27, textureUrl: "assets/saturn.jpg" },
        { name: "Uranus", r: 4.0, dist: 384, speed: 0.006, inclination: 0.8, node: 74, obliquity: 97.8, retrograde: false, rotationSpeed: 1.39, textureUrl: "assets/uranus.jpg" },
        { name: "Neptune", r: 3.9, dist: 601, speed: 0.005, inclination: 1.8, node: 131, obliquity: 28.3, retrograde: false, rotationSpeed: 1.49, textureUrl: "assets/neptune.jpg" },
        { name: "Pluto", r: 0.19, dist: 790, speed: 0.004, inclination: 17.2, node: 110, obliquity: 122.5, retrograde: false, rotationSpeed: 0.16, textureUrl: "assets/pluto.jpg" }
    ];

    planetData.forEach(data => {
        // 軌道システムの構築（3段階のグループ階層）
        // 1. systemGroup: 昇交点黄経の回転を適用
        const systemGroup = new THREE.Group();
        scene.add(systemGroup);
        systemGroup.rotation.y = THREE.MathUtils.degToRad(data.node);

        // 2. inclinedGroup: 軌道傾斜角を適用
        const inclinedGroup = new THREE.Group();
        inclinedGroup.rotation.x = THREE.MathUtils.degToRad(data.inclination);
        systemGroup.add(inclinedGroup);

        // 3. 軌道線（リング）の作成
        // 幅はズームに応じて動的に調整されるため、baseOrbitWidthを保持
        const baseOrbitWidth = 0.1;
        const orbitGeometry = new THREE.RingGeometry(data.dist - baseOrbitWidth, data.dist + baseOrbitWidth, 96);
        const orbitMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
        orbit.rotation.x = Math.PI / 2;
        inclinedGroup.add(orbit);

        // 惑星本体の作成
        const geometry = new THREE.SphereGeometry(data.r, 24, 24);

        const texture = textureLoader.load(data.textureUrl, (loadedTexture) => {
        }, undefined, (err) => {
            console.warn('Failed to load texture for ' + data.name + ': ' + data.textureUrl + '. Using default color.');
        });

        const material = createPlanetMaterial(texture);
        const mesh = new THREE.Mesh(geometry, material);

        // 自転軸の傾きを適用（obliquity: 公転面に対する自転軸の傾き）
        mesh.rotation.x = THREE.MathUtils.degToRad(data.obliquity);

        // 公転用のピボットグループ（惑星を距離分だけ離して配置）
        const pivot = new THREE.Group();
        inclinedGroup.add(pivot);

        pivot.add(mesh);
        mesh.position.set(data.dist, 0, 0); // 軌道距離分だけ離す

        const planetLabel = createLabel(data.name, getLabelOffsetByRadius(data.r));
        mesh.add(planetLabel);

        // 土星の輪の作成（ringフラグがtrueの場合のみ）
        let ringMesh = null;
        let ringTexture = null;
        if (data.ring) {
            // 実際の土星半径比に近づける（内縁: 約1.15倍, 外縁: 約2.4倍）
            const ringInnerRadius = data.r * 1.15;
            const ringOuterRadius = data.r * 2.4;
            const ringGeo = new THREE.RingGeometry(ringInnerRadius, ringOuterRadius, 64);

            // カスタムUVマッピング: 円周方向に沿ってテクスチャをマッピング
            // RingGeometryはXY平面に配置されるため、円形のUV座標を計算
            const positions = ringGeo.attributes.position.array;
            const uvs = [];
            const innerRadius = ringInnerRadius;
            const outerRadius = ringOuterRadius;

            for (let i = 0; i < positions.length; i += 3) {
                const x = positions[i];
                const y = positions[i + 1];
                const z = 0;

                // 角度からU座標を計算（0度がU=0、360度がU=1）
                const angle = Math.atan2(y, x);
                const u = (angle + Math.PI) / (2 * Math.PI);

                // 半径方向の位置からV座標を計算（内側がV=1、外側がV=0）
                const distance = Math.sqrt(x * x + y * y);
                const v = (distance - innerRadius) / (outerRadius - innerRadius);

                uvs.push(u, 1.0 - v); // V座標を反転
            }

            ringGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

            ringTexture = textureLoader.load("assets/saturn_ring_alpha.png", (loadedTexture) => {
                loadedTexture.wrapS = THREE.RepeatWrapping;
                loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
                loadedTexture.repeat.set(1, 1);
            }, undefined, (err) => {
                console.error('Failed to load Saturn ring texture', err);
            });
            if (ringTexture) {
                ringTexture.wrapS = THREE.RepeatWrapping;
                ringTexture.wrapT = THREE.ClampToEdgeWrapping;
                ringTexture.repeat.set(1, 1);
            }
            const ringMat = createRingMaterial(ringTexture);
            ringMesh = new THREE.Mesh(ringGeo, ringMat);
            ringMesh.rotation.x = Math.PI / 2.5;
            mesh.add(ringMesh);
        }

        // 地球の場合のみ、ISSと月を追加
        let issOrbit = null;
        let moonOrbit = null;
        let moonMesh = null;
        let moonTexture = null;
        if (data.name === "Earth") {
            // ISS（国際宇宙ステーション）の軌道
            issOrbit = new THREE.Group();
            issOrbit.position.set(data.dist, 0, 0); // 地球の公転位置に配置
            issOrbit.rotation.z = Math.PI / 4; // 軌道の傾き
            issOrbit.rotation.x = Math.PI / 6; // 軌道の傾き
            pivot.add(issOrbit);

            const issGroup = createISSModel();
            issGroup.position.set(data.r + 0.8, 0, 0); // 地球の表面から少し離れた位置
            issOrbit.add(issGroup);

            const issLabel = createLabel('ISS', 0.55);
            issGroup.add(issLabel);

            // 月の軌道
            moonOrbit = new THREE.Group();
            moonOrbit.position.set(data.dist, 0, 0); // 地球の公転位置に配置
            pivot.add(moonOrbit);

            const moonGeometry = new THREE.SphereGeometry(data.r * 0.27, 12, 12); // 地球の約1/4のサイズ
            moonTexture = textureLoader.load("assets/moon.jpg", undefined, undefined, (err) => {
                console.error('Failed to load moon texture', err);
            });
            const moonMaterial = createPlanetMaterial(moonTexture);
            moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
            moonMesh.position.set(data.r + 2.5, 0, 0); // 地球から少し離れた位置
            moonOrbit.add(moonMesh);

            const moonRadius = data.r * 0.27;
            const moonLabel = createLabel('Moon', getLabelOffsetByRadius(moonRadius, 0.04));
            moonMesh.add(moonLabel);
        }

        // 惑星のメッシュに名前を付けておく（レイキャスティング用）
        mesh.userData.planetName = data.name;

        const planetObj = {
            name: data.name,
            mesh: mesh,
            pivot: pivot,
            speed: data.speed,
            distance: data.dist,
            orbit: orbit,
            orbitGeometry: orbitGeometry,
            baseOrbitWidth: baseOrbitWidth,
            retrograde: data.retrograde,
            issOrbit: issOrbit,
            moonOrbit: moonOrbit,
            moonMesh: moonMesh,
            texture: texture,
            moonTexture: data.name === "Earth" ? moonTexture : null,
            ringMesh: ringMesh,
            ringTexture: ringTexture
        };

        planets.push(planetObj);

        if (data.name === "Earth") {
            earthPlanet = planetObj;
        }
    });

}

/**
 * カメラ切り替えボタンのイベントリスナーを設定
 * 
 * UIのカメラモード切り替えボタンにイベントリスナーを登録する。
 * ボタンがクリックされると、toggleCameraMode()が呼び出される。
 * 
 * @see toggleCameraMode() - カメラモードを切り替える関数
 */
function setupCameraToggle() {
    const button = document.getElementById('camera-toggle');
    if (button) {
        button.addEventListener('click', toggleCameraMode);
    }
}

/**
 * カメラモードを切り替える
 * 
 * 'solar'（太陽系全体視点）と 'earth'（地球視点）を切り替える。
 * 太陽系全体視点に戻る際は、カメラ位置をリセットする。
 * 
 * 処理内容:
 * 1. cameraModeを切り替え
 * 2. UIのボタンとステータステキストを更新
 * 3. 太陽系全体視点に戻る場合、カメラ位置をリセット
 * 
 * @see cameraMode - 現在のカメラモード
 */
/**
 * カメラモードに応じた UI（スイッチ表示・サイドメニューの無効表示）
 */
function syncCameraModeUI() {
    const button = document.getElementById('camera-toggle');
    const status = document.getElementById('camera-status');
    const sideMenu = document.getElementById('side-menu');

    if (button && status) {
        if (cameraMode === 'earth') {
            status.textContent = '地球視点固定';
            button.classList.add('active');
            sideMenu?.classList.add('gestures-disabled');
        } else {
            status.textContent = '太陽系全体';
            button.classList.remove('active');
            sideMenu?.classList.remove('gestures-disabled');
        }
    }
}

function toggleCameraMode() {
    cameraMode = cameraMode === 'solar' ? 'earth' : 'solar';

    syncCameraModeUI();

    focusTrackingName = null;
    clearPlanetMenuSelection();

    // 太陽系全体視点に戻る際は、カメラ位置をリセット
    if (cameraMode === 'solar') {
        targetRotation.x = 0;
        targetRotation.y = 0;
        targetZoom = 60;
        currentRotation.x = 0;
        currentRotation.y = 0;
    }
}

/**
 * 左メニューの天体ボタンのハイライトを更新
 */
function setPlanetMenuActive(bodyId) {
    document.querySelectorAll('.planet-menu-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.body === bodyId);
    });
}

function clearPlanetMenuSelection() {
    document.querySelectorAll('.planet-menu-item').forEach((btn) => btn.classList.remove('active'));
}

function clearFocusFromUserInput() {
    focusTrackingName = null;
    clearPlanetMenuSelection();
    if (cameraMode === 'solar' && solarCamera) {
        const dist = THREE.MathUtils.clamp(solarCamera.position.length(), SETTINGS.minZoom, SETTINGS.maxZoom);
        currentZoom = dist;
        targetZoom = dist;
    }
}

/**
 * 追従表示用に天体のワールド座標を取得（原点＝太陽中心）
 */
function getBodyFocusWorldPosition(bodyName, out) {
    const v = out || new THREE.Vector3();
    if (bodyName === 'Sun') {
        v.set(0, 0, 0);
        return v;
    }
    const planet = planets.find((p) => p.name === bodyName);
    if (planet) {
        planet.mesh.getWorldPosition(v);
        return v;
    }
    if (bodyName === 'Moon' && earthPlanet && earthPlanet.moonMesh) {
        earthPlanet.moonMesh.getWorldPosition(v);
        return v;
    }
    if (bodyName === 'ISS' && earthPlanet && earthPlanet.issOrbit) {
        const issGroup = earthPlanet.issOrbit.children.find((c) => c.type === 'Group');
        if (issGroup) {
            issGroup.getWorldPosition(v);
            return v;
        }
    }
    return null;
}

/**
 * メニューから天体を選んだとき: 太陽系視点でその天体が画面中央付近に来るよう追従
 */
function selectBodyFromMenu(bodyId) {
    if (!planetInfo[bodyId]) return;

    if (cameraMode === 'earth') {
        cameraMode = 'solar';
        syncCameraModeUI();
    }

    focusTrackingName = bodyId;
    setPlanetMenuActive(bodyId);
    selectedPlanet = bodyId;
    showPlanetInfo(bodyId);
}

/**
 * サイドバーに天体一覧ボタンを生成
 */
function setupPlanetMenu() {
    const list = document.getElementById('planet-menu-list');
    if (!list) return;

    list.replaceChildren();

    SIDEBAR_BODY_IDS.forEach((id) => {
        const info = planetInfo[id];
        if (!info) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'planet-menu-item';
        btn.dataset.body = id;
        const match = info.name.match(/^(.+?)\s*\((.+)\)$/);
        if (match) {
            const jpName = match[1].trim();
            const enName = match[2].trim();
            btn.textContent = `${jpName} / ${enName}`;
        } else {
            btn.textContent = info.name;
        }
        btn.title = info.name;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectBodyFromMenu(id);
        });
        list.appendChild(btn);
    });
}

/**
 * フォーカス対象のワールド空間での代表半径（球メッシュの半径×スケール）
 */
function getFocusBodyRadius(bodyName) {
    if (bodyName === 'Sun' && sunMesh && sunMesh.geometry && sunMesh.geometry.parameters) {
        sunMesh.updateMatrixWorld(true);
        const s = sunMesh.getWorldScale(_focusDir);
        const m = Math.max(s.x, s.y, s.z);
        return sunMesh.geometry.parameters.radius * m;
    }
    const planet = planets.find((p) => p.name === bodyName);
    if (planet && planet.mesh && planet.mesh.geometry && planet.mesh.geometry.parameters) {
        planet.mesh.updateMatrixWorld(true);
        const s = planet.mesh.getWorldScale(_focusDir);
        const m = Math.max(s.x, s.y, s.z);
        return planet.mesh.geometry.parameters.radius * m;
    }
    if (bodyName === 'Moon' && earthPlanet && earthPlanet.moonMesh && earthPlanet.moonMesh.geometry) {
        const mesh = earthPlanet.moonMesh;
        mesh.updateMatrixWorld(true);
        const s = mesh.getWorldScale(_focusDir);
        const m = Math.max(s.x, s.y, s.z);
        const r = mesh.geometry.parameters.radius || 0.5;
        return r * m;
    }
    if (bodyName === 'ISS' && earthPlanet && earthPlanet.issOrbit) {
        const issGroup = earthPlanet.issOrbit.children.find((c) => c.type === 'Group');
        if (issGroup) {
            issGroup.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(issGroup);
            const size = box.getSize(_focusDir);
            return Math.max(size.x, size.y, size.z) * 0.45;
        }
    }
    return 2;
}

/**
 * 透視投影で球が画面内に大きく収まるカメラ距離（垂直FOV基準）
 */
function computeFocusCameraDistance(radius, verticalFovDegrees) {
    const fill = 0.38;
    const fovRad = verticalFovDegrees * Math.PI / 180;
    const tanHalf = Math.tan(fovRad / 2);
    let dist = radius / (tanHalf * fill);
    return THREE.MathUtils.clamp(dist, radius * 1.6, 800);
}

/**
 * メニュー／タップで天体を選択中: カメラ注視点を天体中心に置き、天体が画面中央で大きく見えるように配置
 */
function applyPlanetFocusCamera() {
    if (!focusTrackingName || cameraMode !== 'solar') return false;

    const bodyName = focusTrackingName;
    const targetWorld = getBodyFocusWorldPosition(bodyName, _focusWorldPos);
    if (!targetWorld) return false;

    const radius = getFocusBodyRadius(bodyName);
    let dist = computeFocusCameraDistance(radius, solarCamera.fov);
    if (bodyName === 'Pluto') {
        dist = Math.max(dist, 6.2);
    }

    const dirSunToBody = _focusDir;
    if (targetWorld.lengthSq() < 1e-8) {
        dirSunToBody.set(0, 0, 1);
    } else {
        dirSunToBody.copy(targetWorld).normalize();
    }

    const camWorld = _focusCamWorld.copy(targetWorld).sub(dirSunToBody.multiplyScalar(dist));

    orbitGroup.rotation.set(0, 0, 0);
    currentRotation.x = 0;
    currentRotation.y = 0;
    targetRotation.x = 0;
    targetRotation.y = 0;

    orbitGroup.updateMatrixWorld(true);
    const camLocal = camWorld.clone();
    orbitGroup.worldToLocal(camLocal);

    solarCamera.position.copy(camLocal);
    solarCamera.lookAt(targetWorld);

    const near = Math.max(0.005, Math.min(0.2, dist * 0.02));
    solarCamera.near = near;
    solarCamera.far = 2500;
    solarCamera.updateProjectionMatrix();

    const zSync = THREE.MathUtils.clamp(solarCamera.position.length(), SETTINGS.minZoom, SETTINGS.maxZoom);
    currentZoom = zSync;
    targetZoom = zSync;

    return true;
}

/**
 * 惑星ラベルを作成
 * 
 * CSS2DRendererを使用して、常にカメラを向くHTMLラベルを作成する。
 * ラベルは惑星の上に表示され、カメラが動いても常に正面を向く。
 * 
 * @param {string} text - ラベルに表示するテキスト（例: "Sun", "Earth"）
 * @param {number} offsetY - Y軸方向のオフセット（惑星の中心からの距離、惑星の上に表示）
 * @returns {CSS2DObject} 作成されたラベルオブジェクト
 * @see labels - すべてのラベルを保持する配列（表示/非表示切り替え用）
 */
function createLabel(text, offsetY = 0) {
    const div = document.createElement('div');
    div.className = 'planet-label';
    div.textContent = text;
    div.style.color = '#ffffff';
    div.style.textShadow = '0 0 5px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5)'; // 可読性向上のための影
    div.style.pointerEvents = 'none'; // マウスイベントを無効化
    div.style.userSelect = 'none'; // テキスト選択を無効化
    const label = new CSS2DObject(div);
    label.position.set(0, offsetY, 0);
    // CSS2DObjectのelementプロパティが存在しない場合に備えて設定
    if (!label.element) {
        label.element = div;
    }
    labels.push(label); // 表示/非表示切り替え用に配列に追加
    return label;
}

// ========================================
// マテリアル作成関連の関数
// ========================================

/**
 * 惑星用マテリアルを作成
 * 
 * MeshBasicMaterialを使用して、テクスチャを適用したマテリアルを作成する。
 * 色を白に設定することで、テクスチャの色を正確に表示する。
 * 
 * @param {THREE.Texture} texture - 適用するテクスチャ（惑星の表面画像）
 * @returns {THREE.MeshBasicMaterial} 作成されたマテリアル
 */
function createPlanetMaterial(texture, options = {}) {
    const { lit = true } = options;
    if (!lit) {
        return new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff // 白に設定してテクスチャの色を正確に表示
        });
    }
    // 太陽光（PointLight）の向きに応じて明暗を作り、夜側半球を暗くする
    return new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 1.0,
        metalness: 0.0
    });
}

/**
 * 土星の環用マテリアルを作成
 * 
 * アルファチャンネル付きテクスチャを使用して、土星の輪を表現する。
 * 両面を描画することで、どの角度から見ても輪が見えるようにする。
 * 
 * @param {THREE.Texture} texture - 適用するテクスチャ（アルファチャンネル付き）
 * @returns {THREE.MeshBasicMaterial} 作成されたマテリアル
 */
function createRingMaterial(texture) {
    return new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        side: THREE.DoubleSide, // 両面を描画
        transparent: true,
        opacity: 0.8,
        alphaMap: texture // アルファマップで透明度を制御
    });
}

// ========================================
// 3Dモデル作成関連の関数
// ========================================

/**
 * ISS（国際宇宙ステーション）の3Dモデルを作成
 * 
 * 簡略化されたモデルを作成する。実際のISSを完全に再現するのではなく、
 * 視覚的に認識できる程度の簡略化されたモデルを作成する。
 * 
 * モデルの構成:
 * - 本体モジュール: 円柱を横向きに配置
 * - ソーラーパネル: 左右に2枚配置
 * 
 * @returns {THREE.Group} ISSのグループオブジェクト
 */
function createISSModel() {
    const issGroup = new THREE.Group();

    // 本体モジュール（円柱を横向きに）
    const bodyGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.z = Math.PI / 2; // 横向きに回転
    issGroup.add(body);

    // ソーラーパネル（左右に配置）
    const panelGeo = new THREE.BoxGeometry(0.02, 1.2, 0.3);
    const panelMat = new THREE.MeshStandardMaterial({
        color: 0x111133, // 濃い青
        roughness: 0.9,
        metalness: 0.8 // 金属質感
    });

    const leftPanel = new THREE.Mesh(panelGeo, panelMat);
    leftPanel.position.x = -0.4;
    issGroup.add(leftPanel);

    const rightPanel = new THREE.Mesh(panelGeo, panelMat);
    rightPanel.position.x = 0.4;
    issGroup.add(rightPanel);

    // 全体を縮小
    issGroup.scale.set(0.5, 0.5, 0.5);

    return issGroup;
}

/**
 * 背景の星を生成
 * 
 * カスタムシェーダーを使用して瞬き効果を実現する。
 * 各星は異なるタイミングと速度で瞬くように設定される。
 * 
 * 実装の詳細:
 * - 6,000個の星を3D空間にランダム配置
 * - 各星にランダムな瞬きの位相オフセットと速度を設定
 * - 星のサイズは指数分布で設定（小さな星を多く、大きな星を少なく）
 * - GPUシェーダーで瞬きアニメーションを実現（パフォーマンス最適化）
 * 
 * シェーダーの仕組み:
 * - 頂点シェーダー: sin波を使用して瞬きを計算（0.7から1.0の範囲で変動）
 * - フラグメントシェーダー: 円形のグラデーションで星を描画
 * 
 * @see SETTINGS.starCount - 星の数（デフォルト: 6000）
 */
function setupStars() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const twinkleOffsets = []; // 各星の瞬きの位相オフセット（ランダム）
    const twinkleSpeeds = []; // 各星の瞬きの速度（ランダム）
    const starSizes = []; // 各星のサイズ（ランダム）

    for (let i = 0; i < SETTINGS.starCount; i++) {
        // ランダムな位置に星を配置（-500から500の範囲）
        const x = THREE.MathUtils.randFloatSpread(1000);
        const y = THREE.MathUtils.randFloatSpread(1000);
        const z = THREE.MathUtils.randFloatSpread(1000);
        vertices.push(x, y, z);

        // 各星が異なるタイミングで瞬くようにオフセットを設定
        twinkleOffsets.push(Math.random() * Math.PI * 2);
        // 各星が異なる速度で瞬くように速度を設定（0.5から2.0の範囲）
        twinkleSpeeds.push(0.5 + Math.random() * 1.5);
        // 星のサイズをランダムに設定（指数分布で小さな星を多く、大きな星を少なく）
        const rand = Math.random();
        const size = 0.3 + Math.pow(rand, 2.5) * 2.7; // 0.3から3.0の範囲
        starSizes.push(size);
    }

    // ジオメトリに属性を設定
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('twinkleOffset', new THREE.Float32BufferAttribute(twinkleOffsets, 1));
    geometry.setAttribute('twinkleSpeed', new THREE.Float32BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('starSize', new THREE.Float32BufferAttribute(starSizes, 1));

    // カスタムシェーダーマテリアルで瞬き効果を実現
    const starMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 } // アニメーションループで更新される
        },
        vertexShader: `
            uniform float time;
            attribute float twinkleOffset;
            attribute float twinkleSpeed;
            attribute float starSize;
            varying float vTwinkle;
            varying float vBrightness;
            
            void main() {
                // sin波を使用して瞬きを計算（0.7から1.0の範囲で変動）
                vTwinkle = sin(time * twinkleSpeed + twinkleOffset) * 0.3 + 0.7;
                // 大きい星ほど明るく（最大1.5倍まで）
                vBrightness = min(starSize * 0.5, 1.5);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                // ポイントサイズを距離に応じて調整し、瞬きで変動させる
                gl_PointSize = starSize * (300.0 / -mvPosition.z) * vTwinkle;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying float vTwinkle;
            varying float vBrightness;
            
            void main() {
                // ポイントの中心からの距離を計算（円形のグラデーション）
                float distance = length(gl_PointCoord - vec2(0.5));
                float alpha = 1.0 - smoothstep(0.0, 0.5, distance);
                // 星の色と明るさを設定
                vec3 color = vec3(1.0, 1.0, 1.0) * vBrightness;
                gl_FragColor = vec4(color, alpha * vTwinkle);
            }
        `,
        transparent: true,
        depthWrite: false // 深度バッファへの書き込みを無効化（星が他のオブジェクトの前に表示されるように）
    });

    stars = new THREE.Points(geometry, starMaterial);
    scene.add(stars);
}

// ========================================
// マウス・タッチ操作
// ========================================

/**
 * クライアント座標を findNearestPlanet 用の正規化座標に変換する
 */
function clientToNormalizedScreen(clientX, clientY) {
    const el = containerElement || document.getElementById('canvas-container');
    if (!el) {
        return { x: clientX / window.innerWidth, y: clientY / window.innerHeight };
    }
    const rect = el.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height
    };
}

/**
 * マウスホバー時: 天体のハイライトと一定時間後の説明表示（デスクトップ向け）
 */
function updatePlanetHoverInteraction(screenPos) {
    const nearest = findNearestPlanet(screenPos);
    if (nearest) {
        highlightPlanet(nearest.mesh);
        if (hoveringTargetPlanet === nearest.name) {
            const hoveringDuration = performance.now() - hoveringStartTime;
            if (hoveringDuration >= HOVERING_DURATION) {
                if (selectedPlanet !== nearest.name) {
                    selectedPlanet = nearest.name;
                    showPlanetInfo(nearest.name);
                }
            }
        } else {
            if (hoveringTargetPlanet && selectedPlanet === hoveringTargetPlanet) {
                selectedPlanet = null;
            }
            hoveringTargetPlanet = nearest.name;
            hoveringStartTime = performance.now();
        }
    } else {
        clearPlanetHighlight();
        hoveringTargetPlanet = null;
    }
}

/**
 * 2本指の距離（ピンチ用）
 */
function getTwoPointerDistance() {
    if (activePointers.size < 2) return 0;
    const pts = [...activePointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

/**
 * キャンバス上のポインター操作（ドラッグ回転・ホイール／ピンチズーム・タップで天体情報）
 */
function setupPointerControls() {
    containerElement = document.getElementById('canvas-container');
    if (!containerElement) return;

    containerElement.style.touchAction = 'none';
    containerElement.style.cursor = 'grab';

    const canFinePointerHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    containerElement.addEventListener('pointerdown', (e) => {
        if (cameraMode !== 'solar') return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        try {
            containerElement.setPointerCapture(e.pointerId);
        } catch (_) { /* ignore */ }

        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 1) {
            dragPointerId = e.pointerId;
            dragLastX = e.clientX;
            dragLastY = e.clientY;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            didDrag = false;
            containerElement.style.cursor = 'grabbing';
        }

        if (activePointers.size === 2) {
            dragPointerId = null;
            pinchLastDistance = getTwoPointerDistance();
        }
    });

    containerElement.addEventListener('pointermove', (e) => {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (cameraMode !== 'solar') return;

        if (activePointers.size >= 2) {
            if (focusTrackingName) {
                clearFocusFromUserInput();
            }
            const d = getTwoPointerDistance();
            if (pinchLastDistance > 0 && d > 0) {
                const factor = d / pinchLastDistance;
                targetZoom = Math.max(SETTINGS.minZoom, Math.min(SETTINGS.maxZoom, targetZoom / factor));
            }
            pinchLastDistance = d;
            didDrag = true;
            return;
        }

        if (e.pointerId === dragPointerId) {
            const dx = e.clientX - dragLastX;
            const dy = e.clientY - dragLastY;
            if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD_PX) {
                didDrag = true;
                if (focusTrackingName) {
                    clearFocusFromUserInput();
                }
            }
            targetRotation.y -= dx * ROTATION_SENSITIVITY;
            targetRotation.x -= dy * ROTATION_SENSITIVITY;
            targetRotation.x = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, targetRotation.x));
            dragLastX = e.clientX;
            dragLastY = e.clientY;
        }
    });

    const endPointer = (e) => {
        const pointerCountBefore = activePointers.size;
        const wasDragPointer = e.pointerId === dragPointerId;
        activePointers.delete(e.pointerId);
        const pointerCountAfter = activePointers.size;

        const isSingleFingerTap = pointerCountBefore === 1 && pointerCountAfter === 0;
        if (wasDragPointer && !didDrag && cameraMode === 'solar' && isSingleFingerTap) {
            const pos = clientToNormalizedScreen(e.clientX, e.clientY);
            const hit = findNearestPlanet(pos);
            if (hit) {
                selectedPlanet = hit.name;
                showPlanetInfo(hit.name);
                focusTrackingName = hit.name;
                setPlanetMenuActive(hit.name);
            }
        }

        if (e.pointerId === dragPointerId) {
            dragPointerId = null;
        }

        if (pointerCountAfter < 2) {
            pinchLastDistance = 0;
        }

        if (pointerCountAfter === 1) {
            const id = activePointers.keys().next().value;
            const p = activePointers.get(id);
            dragPointerId = id;
            dragLastX = p.x;
            dragLastY = p.y;
            dragStartX = p.x;
            dragStartY = p.y;
            didDrag = pointerCountBefore >= 2;
        }

        if (pointerCountAfter === 0) {
            didDrag = false;
            containerElement.style.cursor = 'grab';
        }
    };

    containerElement.addEventListener('pointerup', endPointer);
    containerElement.addEventListener('pointercancel', endPointer);

    containerElement.addEventListener('wheel', (e) => {
        if (cameraMode !== 'solar') return;
        e.preventDefault();
        if (focusTrackingName) {
            clearFocusFromUserInput();
        }
        targetZoom = Math.max(SETTINGS.minZoom, Math.min(SETTINGS.maxZoom,
            targetZoom + e.deltaY * WHEEL_ZOOM_FACTOR));
    }, { passive: false });

    if (canFinePointerHover) {
        containerElement.addEventListener('mousemove', (e) => {
            if (e.buttons !== 0) return;
            if (cameraMode !== 'solar') return;
            updatePlanetHoverInteraction(clientToNormalizedScreen(e.clientX, e.clientY));
        });
        containerElement.addEventListener('pointerleave', (e) => {
            if (e.buttons !== 0) return;
            if (cameraMode !== 'solar') return;
            clearPlanetHighlight();
            hoveringTargetPlanet = null;
        });
    }
}

/**
 * メインアニメーションループ
 * 
 * requestAnimationFrameを使用して毎フレーム実行される。
 * 以下の処理を順番に実行する:
 * 1. カメラ位置の更新（updateCameraPosition）
 * 2. 軌道線の太さ調整（updateOrbitLineWidths）
 * 3. 惑星の公転・自転アニメーション
 * 4. 太陽の自転・脈動アニメーション
 * 5. 星の瞬きアニメーション（シェーダー）
 * 6. レンダリング（WebGL + CSS2D）
 * 
 * この関数は一度呼び出されると、アプリケーションが終了するまで
 * 継続的に実行される（再帰的にrequestAnimationFrameを呼び出す）。
 */
function animate() {
    requestAnimationFrame(animate);

    updateCameraPosition();
    updateOrbitLineWidths();

    const time = Date.now() * 0.001; // 秒単位の時間
    planets.forEach(p => {
        // 公転（pivotを回転）
        p.pivot.rotation.y += p.speed * 0.5;

        // 自転（現実の自転速度比率を使用、逆回転の場合は負の値）
        const baseRotationSpeed = 0.01; // 地球の基準速度
        const rotationSpeed = (p.retrograde ? -1 : 1) * (p.rotationSpeed || 1.0) * baseRotationSpeed;
        p.mesh.rotation.y += rotationSpeed;

        // ISSのアニメーション（地球の周りを回る）
        if (p.name === "Earth" && p.issOrbit) {
            p.issOrbit.rotation.y += 0.02;
        }

        // 月のアニメーション（地球の周りを回る、ISSより遅い速度）
        // 月の自転は潮汐ロックのため公転速度と同じ
        if (p.name === "Earth" && p.moonOrbit) {
            p.moonOrbit.rotation.y += 0.015;
            if (p.moonMesh) {
                p.moonMesh.rotation.y += 0.015; // 公転速度と同じ
            }
        }
    });

    // 太陽の自転（現実の太陽は約27日で1回転、地球の約1/27の速度）
    const sunRotationSpeed = 0.01 / 27; // 地球の基準速度の1/27
    sunMesh.rotation.y += sunRotationSpeed;

    // 太陽の脈動効果
    const scale = 1 + Math.sin(time * 2) * 0.02; // 2%の範囲で変動
    sunMesh.scale.set(scale, scale, scale);

    // 星の瞬きアニメーション（シェーダーのtime uniformを更新）
    if (stars && stars.material.uniforms) {
        stars.material.uniforms.time.value = time;
    }

    // 描画
    renderer.render(scene, activeCamera);
    labelRenderer.render(scene, activeCamera);
}

/**
 * ポインター位置から最も近い惑星を選択
 *
 * 画面座標を3D空間に投影し、レイキャスティングで
 * 当たった惑星の中から最も近い（距離が最小の）惑星を返す。
 * 
 * 実装の詳細:
 * - 画面座標を正規化デバイス座標（NDC）に変換
 * - カメラから画面位置へのレイを作成
 * - すべての選択可能なオブジェクト（太陽、惑星、月、ISS）に対してレイキャスティングを実行
 * - 交差点の中から最も近い惑星を選択
 * 
 * @param {Object} screenPosition - 画面座標（正規化済み、0-1の範囲）
 *   @property {number} x - X座標（0が左端、1が右端）
 *   @property {number} y - Y座標（0が上端、1が下端）
 * @returns {Object|null} 選択された星のオブジェクト、またはnull
 *   @property {string} name - 星の名前（"Sun", "Mercury", "Earth"など）
 *   @property {THREE.Mesh} mesh - 星のメッシュオブジェクト
 */
function findNearestPlanet(screenPosition) {
    // 画面座標を正規化デバイス座標に変換（-1から1の範囲）
    const ndcX = (screenPosition.x * 2) - 1;
    const ndcY = 1 - (screenPosition.y * 2); // Y軸を反転（画面座標は上から下、NDCは下から上）

    // レイキャスターを設定（カメラから手の位置へのレイを作成）
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), activeCamera);

    // すべての選択可能なオブジェクトを収集
    const selectableObjects = [];

    // 太陽を追加
    if (sunMesh) {
        sunMesh.userData.planetName = "Sun";
        selectableObjects.push({ mesh: sunMesh, name: "Sun" });
    }

    // すべての惑星を追加
    planets.forEach(planet => {
        selectableObjects.push({ mesh: planet.mesh, name: planet.name });
    });

    // 地球の場合、月とISSも追加
    if (earthPlanet) {
        if (earthPlanet.moonMesh) {
            earthPlanet.moonMesh.userData.planetName = "Moon";
            selectableObjects.push({ mesh: earthPlanet.moonMesh, name: "Moon" });
        }
        // ISSはグループなので、子要素を検索
        if (earthPlanet.issOrbit && earthPlanet.issOrbit.children.length > 0) {
            const issGroup = earthPlanet.issOrbit.children.find(child => child.type === 'Group');
            if (issGroup) {
                issGroup.userData.planetName = "ISS";
                selectableObjects.push({ mesh: issGroup, name: "ISS" });
            }
        }
    }

    // レイキャスティングを実行（すべての子要素も含めて検出）
    const intersects = raycaster.intersectObjects(selectableObjects.map(obj => obj.mesh), true);

    if (intersects.length > 0) {
        // すべての交差点を処理して、最も近い（距離が小さい）惑星を選択
        let bestHit = null;
        let minDistance = Infinity;

        for (const intersect of intersects) {
            const hitObject = intersect.object;
            const hitDistance = intersect.distance;

            // オブジェクトまたはその親を辿って、惑星名を探す
            // 惑星のメッシュは複数のグループ階層の中にある可能性があるため
            let current = hitObject;
            let foundPlanet = null;

            while (current) {
                // userDataに惑星名が保存されているかチェック
                if (current.userData && current.userData.planetName) {
                    const planetName = current.userData.planetName;
                    const selected = selectableObjects.find(obj => obj.name === planetName);
                    if (selected) {
                        foundPlanet = { name: selected.name, mesh: selected.mesh, distance: hitDistance };
                        break;
                    }
                }

                // 直接メッシュと一致するかチェック
                const directMatch = selectableObjects.find(obj => current === obj.mesh);
                if (directMatch) {
                    foundPlanet = { name: directMatch.name, mesh: directMatch.mesh, distance: hitDistance };
                    break;
                }

                current = current.parent;
            }

            // 惑星が見つかり、かつ距離がより近い場合は更新
            if (foundPlanet && hitDistance < minDistance) {
                bestHit = foundPlanet;
                minDistance = hitDistance;
            }
        }

        if (bestHit) {
            return { name: bestHit.name, mesh: bestHit.mesh };
        }
    }

    return null;
}

/**
 * 星の説明を表示
 * 
 * 指定された星の説明パネルを表示する。既に表示されている場合は、
 * 切り替えアニメーション（フェードアウト/フェードイン）を実行する。
 * 
 * タイマー管理:
 * - 説明が表示されると30秒のタイマーが開始される
 * - 説明が切り替わるとタイマーがリセットされる
 * - 30秒経過すると自動的に非表示になる
 * 
 * @param {string} planetName - 星の名前（"Sun", "Mercury", "Earth"など）
 * @see hidePlanetInfo() - 説明を非表示にする関数
 * @see startInfoPanelTimer() - 自動非表示タイマーを開始する関数
 */
function showPlanetInfo(planetName) {
    const info = planetInfo[planetName];
    if (!info) {
        console.warn('説明データが見つかりません:', planetName);
        return;
    }

    const panel = document.getElementById('planet-info-panel');
    const nameElement = document.getElementById('planet-info-name');
    const contentElement = document.getElementById('planet-info-content');

    if (panel && nameElement && contentElement) {
        // 既存のタイマーをクリア（説明が切り替わった場合にリセット）
        if (infoPanelTimer) {
            clearTimeout(infoPanelTimer);
            infoPanelTimer = null;
        }

        panel.dataset.infoBody = planetName;

        const bodyHtml = buildPlanetInfoContentHtml(info);

        // 既に表示されている場合、切り替えアニメーションを実行
        const isAlreadyVisible = panel.classList.contains('visible');

        if (isAlreadyVisible) {
            // 切り替え効果：一度フェードアウトしてから新しい内容を表示
            panel.classList.add('switching');
            panel.style.opacity = '0';
            panel.style.transform = 'scale(0.95)';

            setTimeout(() => {
                // 内容を更新
                nameElement.textContent = info.name;
                contentElement.innerHTML = bodyHtml;

                // フェードイン
                panel.style.opacity = '1';
                panel.style.transform = 'scale(1)';

                setTimeout(() => {
                    panel.classList.remove('switching');
                }, 300);

                // タイマーを再設定（切り替え時もリセット）
                startInfoPanelTimer();
            }, 150);
        } else {
            // 初回表示：スライドインアニメーション
            nameElement.textContent = info.name;
            contentElement.innerHTML = bodyHtml;
            panel.classList.add('visible');

            // タイマーを設定
            startInfoPanelTimer();
        }
    }
}

/**
 * 説明パネルを自動的に非表示にするタイマーを開始
 * 
 * 説明パネルが表示されてから30秒後に自動的に非表示にするタイマーを設定する。
 * 既存のタイマーがある場合は、それをクリアして新しいタイマーを設定する。
 * これにより、説明が切り替わったときにタイマーがリセットされる。
 * 
 * @see INFO_PANEL_AUTO_HIDE_DURATION - タイマーの時間（30秒）
 * @see hidePlanetInfo() - 実際にパネルを非表示にする関数
 */
function startInfoPanelTimer() {
    // 既存のタイマーをクリア
    if (infoPanelTimer) {
        clearTimeout(infoPanelTimer);
    }

    // 30秒後に説明パネルを非表示にする
    infoPanelTimer = setTimeout(() => {
        hidePlanetInfo();
        infoPanelTimer = null;
    }, INFO_PANEL_AUTO_HIDE_DURATION);
}

/**
 * 星の説明を非表示
 * 
 * 説明パネルをフェードアウトアニメーション付きで非表示にする。
 * アニメーション完了後、パネルの状態をリセットする。
 * 
 * 処理内容:
 * 1. フェードアウトアニメーション（0.3秒）
 * 2. パネルを非表示
 * 3. ハイライトを解除
 * 4. タイマーをクリア
 * 
 * @see showPlanetInfo() - 説明を表示する関数
 */
function hidePlanetInfo() {
    const panel = document.getElementById('planet-info-panel');
    if (panel && panel.classList.contains('visible')) {
        // フェードアウトアニメーション
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.95)';

        // アニメーション完了後に非表示
        setTimeout(() => {
            panel.classList.remove('visible');
            panel.style.opacity = '';
            panel.style.transform = '';
            panel.removeAttribute('data-info-body');
            selectedPlanet = null;
        }, 300); // フェードアウトの時間（0.3秒）
    } else {
        selectedPlanet = null;
    }

    // ハイライトも解除
    clearPlanetHighlight();

    // タイマーをクリア
    if (infoPanelTimer) {
        clearTimeout(infoPanelTimer);
        infoPanelTimer = null;
    }
}

// ========================================
// ハイライト関連の関数
// ========================================

/**
 * 惑星をハイライト表示
 * 
 * 指定された惑星のメッシュをハイライト表示する。
 * 元のマテリアルを保存しておき、ハイライト解除時に復元できるようにする。
 * 
 * ハイライト方法:
 * - MeshBasicMaterial: 色を青みがかった色に変更
 * - MeshStandardMaterial: エミッシブを追加
 * 
 * @param {THREE.Mesh} mesh - ハイライトする惑星のメッシュ
 * @see clearPlanetHighlight() - ハイライトを解除する関数
 */
function highlightPlanet(mesh) {
    // 既にハイライトされている場合は何もしない
    if (highlightedPlanet === mesh) return;

    // 前のハイライトを解除
    clearPlanetHighlight();

    if (mesh && mesh.material) {
        highlightedPlanet = mesh;
        // 元のマテリアルを保存
        if (!mesh.userData.originalMaterial) {
            mesh.userData.originalMaterial = mesh.material.clone();
        }

        // ハイライト用のマテリアルを作成
        // MeshBasicMaterialの場合は色を変更してハイライト
        const highlightMaterial = mesh.material.clone();
        if (highlightMaterial.isMeshBasicMaterial) {
            // MeshBasicMaterialの場合は色を変更
            const originalColor = highlightMaterial.color.clone();
            highlightMaterial.color.lerp(new THREE.Color(0x4444ff), 0.3); // 青みがかった色に変更
            highlightMaterial.userData.originalColor = originalColor;
        } else if (highlightMaterial.emissive) {
            // MeshStandardMaterialなどの場合はエミッシブを使用
            highlightMaterial.emissive.setHex(0x4444ff);
            highlightMaterial.emissiveIntensity = 0.5;
        }
        mesh.material = highlightMaterial;
    }
}

/**
 * 惑星のハイライトを解除
 * 
 * 現在ハイライトされている惑星のマテリアルを元の状態に戻す。
 * 保存されていた元のマテリアルを使用して復元する。
 * 
 * @see highlightPlanet() - ハイライトを適用する関数
 */
function clearPlanetHighlight() {
    if (highlightedPlanet && highlightedPlanet.userData.originalMaterial) {
        highlightedPlanet.material = highlightedPlanet.userData.originalMaterial;
        highlightedPlanet.userData.originalMaterial = null;
        highlightedPlanet = null;
    }
}

// ========================================
// カメラ操作関連の関数
// ========================================

/**
 * 地球視点カメラの位置と向きを計算
 * 
 * orbitGroupの回転を考慮せず、常に絶対座標系で計算する。
 * 地球視点カメラはorbitGroupの回転に依存しない絶対座標系で配置される必要がある。
 * 
 * 計算の流れ:
 * 1. orbitGroupの回転を一時的に無効化
 * 2. 地球の絶対位置を取得（公転を考慮）
 * 3. 地球のローカル座標系でのカメラ方向を定義（地球の自転に追従）
 * 4. ローカル方向をワールド座標に変換
 * 5. 地球の中心から外側に向かって、半径+0.01だけ離れた位置にカメラを配置
 * 6. orbitGroupの回転を元に戻す
 * 
 * @returns {{position: THREE.Vector3, direction: THREE.Vector3} | null} カメラの位置と向き、またはnull
 *   @property {THREE.Vector3} position - カメラの位置（ワールド座標）
 *   @property {THREE.Vector3} direction - カメラの向き（ワールド座標）
 */
function calculateEarthCameraPositionAndDirection() {
    if (!earthPlanet || !orbitGroup) return null;

    // orbitGroupの回転を一時的に無効化して、地球の絶対位置を取得
    const savedRotationX = orbitGroup.rotation.x;
    const savedRotationY = orbitGroup.rotation.y;

    orbitGroup.rotation.x = 0;
    orbitGroup.rotation.y = 0;
    orbitGroup.updateMatrixWorld(true);

    planets.forEach(p => {
        p.mesh.updateMatrixWorld();
    });

    // 地球の中心位置を取得（公転を考慮、orbitGroupの回転は無視）
    const earthWorldPosition = new THREE.Vector3();
    earthPlanet.mesh.getWorldPosition(earthWorldPosition);

    // 地球のローカル座標系でのカメラ方向を定義（地球の自転に追従）
    // 地球のローカルX軸方向に半径分だけ外側
    const earthRadius = 1.0;
    const localCameraDirection = new THREE.Vector3(1, 0, 0);

    // 地球の回転行列を取得（自転を含む、orbitGroupの回転は無視）
    const earthQuaternion = new THREE.Quaternion();
    earthPlanet.mesh.getWorldQuaternion(earthQuaternion);

    // ローカル方向をワールド座標に変換
    const worldCameraDirection = localCameraDirection.clone().applyQuaternion(earthQuaternion);

    // 地球の中心から外側に向かって、半径+0.01だけ離れた位置にカメラを配置
    const worldCameraPosition = earthWorldPosition.clone();
    const offsetDistance = earthRadius + 0.01;
    worldCameraPosition.add(worldCameraDirection.multiplyScalar(offsetDistance));

    // orbitGroupの回転を元に戻す
    orbitGroup.rotation.x = savedRotationX;
    orbitGroup.rotation.y = savedRotationY;
    orbitGroup.updateMatrixWorld(true);

    planets.forEach(p => {
        p.pivot.updateMatrixWorld(true);
        p.mesh.updateMatrixWorld(true);
    });

    return {
        position: worldCameraPosition,
        direction: worldCameraDirection
    };
}

/**
 * 地球視点カメラの位置のみを取得（後方互換性のため）
 * 
 * calculateEarthCameraPositionAndDirection()のラッパー関数。
 * 位置のみが必要な場合に使用する。
 * 
 * @returns {THREE.Vector3 | null} カメラの位置、またはnull
 * @see calculateEarthCameraPositionAndDirection() - 位置と向きの両方を取得する関数
 */
function calculateEarthCameraPosition() {
    const result = calculateEarthCameraPositionAndDirection();
    return result ? result.position : null;
}

/**
 * カメラ位置を更新
 * 
 * カメラモードに応じて、太陽系全体視点または地球視点のカメラを更新する。
 * この関数は毎フレーム呼び出され、カメラの位置と向きを更新する。
 * 
 * 太陽系全体視点（'solar'）:
 * - 目標値と現在値を線形補間してスムーズな動きを実現
 * - orbitGroupを回転させることで、太陽系全体を回転
 * - カメラのZ座標を変更することでズーム
 * - 地球視点カメラの位置と向きをマーカーで表示
 * 
 * 地球視点（'earth'）:
 * - 地球の表面から外側を見る固定位置・角度
 * - 地球の自転に追従
 * - ドラッグ・ズーム操作の影響を受けない
 * 
 * @see cameraMode - 現在のカメラモード
 * @see calculateEarthCameraPositionAndDirection() - 地球視点カメラの位置を計算
 */
function updateCameraPosition() {
    if (cameraMode === 'solar') {
        // 太陽系全体視点
        activeCamera = solarCamera;

        const focusApplied = applyPlanetFocusCamera();

        if (!focusApplied) {
            // 現在値を目標値に近づける（線形補間）
            currentRotation.x += (targetRotation.x - currentRotation.x) * SETTINGS.cameraSmooth;
            currentRotation.y += (targetRotation.y - currentRotation.y) * SETTINGS.cameraSmooth;
            currentZoom += (targetZoom - currentZoom) * SETTINGS.zoomSmooth;

            // 回転を適用（orbitGroupを回転させることで、太陽系全体を回転）
            orbitGroup.rotation.y = currentRotation.y;
            orbitGroup.rotation.x = currentRotation.x;

            // ズームを適用（カメラのローカルZ座標）
            solarCamera.position.set(0, 0, currentZoom);
            solarCamera.lookAt(0, 0, 0);

            solarCamera.near = 0.1;
            solarCamera.far = 1000;
            solarCamera.updateProjectionMatrix();
        }

        // 地球視点カメラの位置計算（マーカー表示は無効）
        calculateEarthCameraPositionAndDirection();
    } else if (cameraMode === 'earth' && earthPlanet) {
        // 地球視点（地球から外側を見る）- 固定位置・角度
        activeCamera = earthCamera;

        const cameraData = calculateEarthCameraPositionAndDirection();
        if (!cameraData) return;

        const worldCameraPosition = cameraData.position;
        const worldLookDirection = cameraData.direction;

        // 地球視点カメラはsceneに直接追加されているため、ワールド座標で直接設定
        earthCamera.position.copy(worldCameraPosition);

        // カメラのlookAt位置を計算（矢印の向きと同じ）
        const worldLookAtPosition = worldCameraPosition.clone().add(worldLookDirection.clone().multiplyScalar(100));
        earthCamera.lookAt(worldLookAtPosition);

        // 地球視点では近接平面を非常に小さく設定（地球の表面が描画されるように）
        earthCamera.near = 0.001;
        earthCamera.far = 1000;
        earthCamera.fov = 60;
        earthCamera.updateProjectionMatrix();

        // 地球視点の時は位置マーカーなし
    }
}

/**
 * 軌道線の太さをズームに応じて動的に調整
 * 
 * ズームアウトするほど線を太くして、遠くの軌道も見やすくする。
 * パフォーマンスを考慮し、変化が大きい場合のみジオメトリを再作成する。
 * 
 * 実装の詳細:
 * - 基準ズーム（60）に対する現在のズームの比率を計算
 * - 比率に応じて軌道線の太さを調整（最小1倍、最大10倍）
 * - 変化が0.01以上の場合のみジオメトリを再作成（パフォーマンス最適化）
 * 
 * @see currentZoom - 現在のズーム値
 * @see planet.baseOrbitWidth - 各惑星の基準軌道線の太さ
 */
function updateOrbitLineWidths() {
    const baseZoom = 60; // 基準ズーム（初期値）
    const zoomRatio = currentZoom / baseZoom;

    // ズームアウトするほど線を太くする（最小1倍、最大10倍）
    const widthMultiplier = Math.max(1.0, Math.min(10.0, zoomRatio * 0.5));

    planets.forEach(planet => {
        if (planet.orbit && planet.orbitGeometry && planet.baseOrbitWidth) {
            const newWidth = planet.baseOrbitWidth * widthMultiplier;
            const innerRadius = planet.distance - newWidth;
            const outerRadius = planet.distance + newWidth;

            // パフォーマンスを考慮して、変化が大きい場合のみジオメトリを再作成
            if (Math.abs(newWidth - (planet.lastOrbitWidth || 0)) > 0.01) {
                planet.orbitGeometry.dispose(); // 古いジオメトリを破棄
                planet.orbitGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 96);
                planet.orbit.geometry = planet.orbitGeometry;
                planet.lastOrbitWidth = newWidth;
            }
        }
    });
}

/**
 * ウィンドウリサイズ時の処理
 * 
 * ウィンドウサイズが変更されたときに、カメラのアスペクト比と
 * レンダラーのサイズを更新する。
 * 
 * 更新内容:
 * - 太陽系全体カメラのアスペクト比
 * - 地球視点カメラのアスペクト比
 * - WebGLレンダラーのサイズ
 * - CSS2Dレンダラーのサイズ
 * 
 * この関数はwindow.addEventListener('resize', onWindowResize)で
 * 登録されているため、ウィンドウサイズが変更されるたびに自動的に呼び出される。
 */
function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const w = container ? container.clientWidth : window.innerWidth;
    const h = container ? container.clientHeight : window.innerHeight;
    const aspect = w / h;
    solarCamera.aspect = aspect;
    solarCamera.updateProjectionMatrix();
    earthCamera.aspect = aspect;
    earthCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
}

// ========================================
// UI操作関連の関数
// ========================================

/**
 * ラベルの表示/非表示を切り替える
 * 
 * すべての惑星ラベルを一括で表示/非表示する。
 * UIのトグルスイッチと連携して動作する。
 * 
 * 処理内容:
 * 1. labelsVisibleフラグを切り替え
 * 2. すべてのラベルの表示/非表示を更新
 * 3. UIのトグルスイッチとステータステキストを更新
 * 
 * @see labels - すべてのラベルを保持する配列
 * @see labelsVisible - ラベルの表示/非表示フラグ
 */
function toggleLabels() {
    labelsVisible = !labelsVisible;

    labels.forEach(label => {
        if (label) {
            const element = label.element;
            if (element && element.style) {
                element.style.display = labelsVisible ? 'block' : 'none';
                element.style.visibility = labelsVisible ? 'visible' : 'hidden';
            }
        }
    });

    // UIを更新
    const toggle = document.getElementById('label-toggle');
    const status = document.getElementById('label-status');
    if (toggle && status) {
        if (labelsVisible) {
            status.textContent = '表示';
            toggle.classList.add('active');
        } else {
            status.textContent = '非表示';
            toggle.classList.remove('active');
        }
    }
}
