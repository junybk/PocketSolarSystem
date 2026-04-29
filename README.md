# Pocket Solar System

マウス・タッチ操作で太陽系を探索できる 3D シミュレーションです。  
Three.js で描画し、惑星の相対サイズ・公転/自転・太陽光による明暗変化をリアルタイムで表示します。

## 現在の実装概要

- マウス/タッチでカメラ回転・ズーム（太陽系全体モード）
- 惑星リストから天体を選択すると、その天体中心へカメラフォーカス
- 太陽光に対して昼夜面が動的に変化（夜側は暗く表示）
- ラベル表示トグル、説明パネル表示（自動非表示あり）
- モバイルではハンバーガーメニューでサイドメニューを開閉

## 起動方法

```bash
# Python 3
python -m http.server 8000
```

ブラウザで `http://localhost:8000` を開いてください。

## 主な操作

- ドラッグ: 回転（太陽系全体モード）
- ホイール / ピンチ: ズーム
- クリック / タップ: 天体説明を表示
- サイドメニューの天体ボタン: 対象天体へフォーカス

## ドキュメント

- [システム仕様書](docs/SYSTEM_SPECIFICATION.md)
- [オブジェクト仕様書](docs/SOLAR_SYSTEM_SPECS.md)

## ファイル構成

```text
solar-system/
├── index.html
├── style.css
├── script.js
├── README.md
├── docs/
│   ├── SYSTEM_SPECIFICATION.md
│   └── SOLAR_SYSTEM_SPECS.md
└── assets/
```

