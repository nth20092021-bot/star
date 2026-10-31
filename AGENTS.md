# 🌌 KIẾN TRÚC PHÂN QUYỀN AGENTS: "ĐÀI THIÊN VĂN DỆT CHÒM SAO"
# (The Celestial Constellation Weaver - Multi-Agent Architecture)

Tài liệu này xác lập quy ước phân quyền, ranh giới trách nhiệm và cơ chế phối hợp giữa **Antigravity** (Core Architect & Physics) và **DeepSeek** (Graphics & Shaders) trong dự án Web Game 3D Three.js + GSAP.

---

## 🏛️ 1. Bản Đồ Phân Quyền Thư Mục (Codebase Boundary Matrix)

| Thư mục / File | Antigravity (Core & Physics) | DeepSeek (Graphics & Shaders) | Mô tả chi tiết |
| :--- | :---: | :---: | :--- |
| **`/src/core/**`** | 🟢 **Toàn quyền Read/Write** | 🔴 **CẤM CHỈNH SỬA (Forbidden)** | Tính toán quỹ đạo 28 sao, vật lý sao chổi, thuật toán dệt chòm sao, Camera HUD UI |
| **`/src/graphics/**`** | 🟡 Chỉ Review / Read-only | 🟢 **Toàn quyền Read/Write** | Vòm trời Milky Way shader, Armillary Sphere bằng đồng, `LineSegments`, Supernova FX, `UnrealBloomPass` |
| **`/src/shared/**`** | 🟢 Read/Write (Quản trị hợp đồng) | 🔵 **Chỉ Đọc (Read-only)** | Hợp đồng giao tiếp chung: `CosmicTypes.ts`, `CosmicEventBus.ts`, `ICelestialGraphics.ts` |
| **`/src/main.ts`** | 🟢 **Toàn quyền Read/Write** | 🔴 **CẤM SỬA TRỰC TIẾP** | Điểm khởi chạy ứng dụng, liên kết EventBus giữa Core và Graphics |
| **Cấu hình gốc** (`package.json`, `tsconfig.json`, `mcp_config.json`, v.v.) | 🟢 Quản trị chính | 🟡 Đề xuất thông qua Antigravity | Các thư viện nền tảng và MCP Server |

---

## 🤖 2. Vai Trò & Nhiệm Vụ Chi Tiết

### 🌟 Antigravity (Core Architect & Lead Physics Engine)
- **Khu vực phụ trách**: `/src/core/`, `/src/shared/`, `/src/main.ts`.
- **Nhiệm vụ trọng tâm**:
  1. **Toán học quỹ đạo (`CelestialOrbits.ts`)**: Tính toán tọa độ cầu (Spherical Coordinates: $r, \theta, \phi$) cho 28 ngôi sao (đại diện cho 28 học sinh), phân bố đều trong không gian 3D, không va chạm/chồng lấn.
  2. **Vật lý Sao Chổi (`CometPhysicsEngine.ts`)**: Mô phỏng chuyển động của sao chổi lượn qua các vì sao bằng phương trình vector gia tốc, quán tính mượt mà và lưu lại `tailHistory`.
  3. **Thuật toán dệt chòm sao (`ConstellationWeaver.ts`)**: Chọn lộ trình dệt ngẫu nhiên nhưng giảm tốc dần theo hàm easing (GSAP / exponential decay) cho đến khi dừng hẳn vào một "ngôi sao định mệnh" (Winner Star).
  4. **Camera Controller & Minimal UI (`CelestialUI.ts`)**: Điều khiển góc nhìn camera chuyển động theo sao chổi và hiển thị HUD tinh tế (thông tin ngôi sao, tên học sinh, thanh tốc độ dệt).
  5. **Main Bootstrap (`/src/main.ts`)**: Khởi tạo `CelestialGraphicsEngine` qua interface `ICelestialGraphics`, đấu nối lắng nghe `CosmicEventBus`.

### ✨ DeepSeek (Lead Visuals & 3D Celestial Shaders Engineer - Kilo Code / Cline)
- **Khu vực phụ trách**: Duy nhất `/src/graphics/`.
- **Nhiệm vụ trọng tâm**:
  1. **Hiện thực hóa `ICelestialGraphics`**: Khởi tạo và quản lý lớp `CelestialGraphicsEngine.ts` nằm trong `/src/graphics/`.
  2. **Vòm trời Milky Way Shader (`MilkyWaySkyDome.ts`)**: Viết Custom GLSL Vertex & Fragment Shader tái hiện dải ngân hà huyền bí với hiệu ứng mây tinh vân (nebula noise) và bụi sao lấp lánh (twinkling star particles).
  3. **Đài Thiên Văn Armillary Sphere (`ArmillarySphere.ts`)**: Dựng mô hình đài thiên văn cổ kính với các vòng xích đạo, hoàng đạo, kinh tuyến bằng chất liệu đồng kim loại cổ (`THREE.MeshStandardMaterial` roughness, metalness, normal maps).
  4. **Tia sáng dệt chòm sao (`DynamicConstellationLines.ts`)**: Sử dụng `THREE.LineSegments` kết hợp `BufferGeometry` động và custom shader glow để vẽ các cạnh `ConstellationEdge[]` phát sáng khi sao chổi bay qua.
  5. **Vụ nổ hạt Supernova (`SupernovaEffect.ts`)**: Hệ thống `THREE.Points` phát nổ hàng ngàn hạt ánh sáng cùng sóng xung kích (shockwave ring) khi phát tín hiệu `STAR_LOCKED_SUPERNOVA`.
  6. **Post-processing (`PostProcessingManager.ts`)**: Thiết lập `EffectComposer`, `RenderPass`, và `UnrealBloomPass` với ngưỡng bloom tinh chỉnh để tia sáng và ngôi sao rực rỡ mà không bị cháy sáng.

---

## 📡 3. Quy Ước Giao Tiếp Qua Shared Contract

Mọi giao tiếp giữa Antigravity và DeepSeek **bắt buộc** thông qua 3 file trong `/src/shared/`:

```
                    ┌────────────────────────────┐
                    │      /src/shared/          │
                    │   - CosmicTypes.ts         │
                    │   - CosmicEventBus.ts      │
                    │   - ICelestialGraphics.ts  │
                    └──────────────┬─────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   ┌──────────────────────┐                  ┌──────────────────────┐
   │      Antigravity     │                  │       DeepSeek       │
   │      /src/core/      │                  │    /src/graphics/    │
   │  (Vật lý & Sự kiện)  │                  │  (Render 3D & Shaders)│
   └──────────────────────┘                  └──────────────────────┘
```

1. **`CosmicTypes.ts`**: Định nghĩa kiểu dữ liệu duy nhất cho `StarNode`, `ConstellationEdge`, `CometPhysicsState`. Không agent nào được phép tự ý thay đổi cấu trúc mà không có sự đồng thuận.
2. **`CosmicEventBus.ts`**: Kênh truyền tín hiệu Type-Safe giữa Core và Graphics (`WEAVE_START`, `COMET_STEP`, `STAR_LINKED`, `STAR_LOCKED_SUPERNOVA`, `CAMERA_RESET`).
3. **`ICelestialGraphics.ts`**: Bản giao kèo phương thức mà `CelestialGraphicsEngine` của DeepSeek phải tuân thủ nghiêm ngặt.

---

## 🛠️ 4. Quy Chuẩn Sử Dụng MCP Servers

Cả hai agent sử dụng các MCP Server được cấu hình trong `mcp_config.json` và `.mcp.json`:
- **Context7 MCP (`@upstash/context7-mcp`)**: Dùng để tra cứu tài liệu Three.js r170+, API `BufferAttribute.needsUpdate`, `LineSegments`, `UnrealBloomPass` và GSAP 3.x.
- **Sequential Thinking MCP (`@modelcontextprotocol/server-sequential-thinking`)**: Dùng để suy luận từng bước cho thuật toán shader toán học (Simplex noise, FBM) và thuật toán phân bổ 28 điểm cầu Fibonacci sphere.
- **Filesystem & Git MCP**: Đảm bảo phân tách commit rõ ràng:
  - Commit của Antigravity: `feat(core): ...`, `refactor(core): ...`, `contract(shared): ...`
  - Commit của DeepSeek: `feat(graphics): ...`, `shader(graphics): ...`, `fx(supernova): ...`
- **Playwright MCP (`@playwright/mcp`)**: Dùng để mở web chạy thử, kiểm tra WebGL context, lắng nghe `console.error` (bắt lỗi GLSL compile shader) và đo đạc FPS ổn định 60fps.

