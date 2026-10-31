# 🔌 HƯỚNG DẪN KẾT NỐI MCP SERVERS CHO DEEPSEEK (KILO CODE / CLINE)
# Dự án: "Đài Thiên Văn Dệt Chòm Sao" (The Celestial Constellation Weaver)

Tài liệu này hướng dẫn cách kết nối và sử dụng hệ thống **Model Context Protocol (MCP)** dành cho Extension chạy DeepSeek (Kilo Code hoặc Cline trong VS Code / Cursor).

---

## 1. Danh Sách MCP Servers Được Cấu Hình

| Tên MCP Server | Package / Command | Mục đích & Lợi ích |
| :--- | :--- | :--- |
| **`context7`** | `npx -y @upstash/context7-mcp` | Tra cứu API Three.js (r170+), `LineSegments`, `BufferGeometry`, `UnrealBloomPass`, và GSAP 3.x chuẩn xác, tránh bị hallucinate API cũ |
| **`sequential-thinking`** | `npx -y @modelcontextprotocol/server-sequential-thinking` | Tư duy toán học đa bước cho DeepSeek viết Shader GLSL phức tạp (Simplex Noise, FBM cho Milky Way, Supernova shockwave) |
| **`filesystem`** | `npx -y @modelcontextprotocol/server-filesystem <path>` | Đọc/ghi file an toàn theo phân quyền dự án, cho phép truy xuất assets và shaders |
| **`git`** | `uvx mcp-server-git --repository <path>` | Kiểm tra diff, commit, log và giữ an toàn ranh giới giữa `/src/core` và `/src/graphics` |
| **`playwright`** | `npx -y @playwright/mcp@latest` | Mở browser tự động, kiểm tra canvas 3D, bắt lỗi compile shader trên WebGL console và đo FPS |
| **`threejs-devtools`** | `npx -y threejs-devtools-mcp` | Kiểm tra cây cảnh 3D (Scene graph), số lượng Draw calls, texture và rò rỉ bộ nhớ |

---

## 2. File Cấu Hình Sẵn Có Trong Dự Án

Dự án đã tạo sẵn 3 file cấu hình:
1. **`mcp_config.json`**: Cấu hình MCP chuẩn hóa ở thư mục gốc dự án (dành cho Antigravity & công cụ chung).
2. **`.mcp.json`**: File cấu hình tự động nhận diện bởi Cline, Roo Code và Claude Code tại thư mục workspace.
3. **`.kilocode/mcp.json`**: File cấu hình dành riêng cho extension Kilo Code.

---

## 3. Cách Kích Hoạt Trong VS Code / Cursor

### Trường Hợp A: Sử Dụng Kilo Code Extension
1. Mở VS Code / Cursor tại thư mục dự án `gametest_1004`.
2. Mở bảng điều khiển của **Kilo Code** (biểu tượng Kilo trên Activity Bar bên trái).
3. Nhấp vào biểu tượng **Cài đặt (Gear icon)** hoặc **MCP Servers**.
4. Kilo Code sẽ tự động đọc cấu hình từ file `.kilocode/mcp.json` hoặc `.mcp.json`.
5. Nếu cần cấu hình thủ công qua Global Settings:
   - Nhấn `Ctrl + Shift + P` -> gõ `Preferences: Open User Settings (JSON)`.
   - Sao chép toàn bộ khối `"mcpServers"` từ file `.mcp.json` vào cài đặt MCP của Kilo Code.
6. Khởi động lại hoặc bấm **Refresh MCP Servers**. Bạn sẽ thấy các server `context7`, `sequential-thinking`, `filesystem`, `git`, `playwright`, `threejs-devtools` chuyển sang trạng thái **Connected (Xanh lá)**.

### Trường Hợp B: Sử Dụng Cline Extension
1. Mở Extension **Cline** trên thanh bên trái.
2. Nhấn vào biểu tượng **MCP** (hình phích cắm điện ở góc trên).
3. Cline hỗ trợ Project-Level MCP: Cline sẽ phát hiện file `.mcp.json` ngay trong thư mục gốc và hỏi bạn có muốn kích hoạt hay không -> Chọn **Allow / Always Allow**.
4. Nếu Cline sử dụng file cấu hình toàn cục:
   - Windows Path: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
   - Dán nội dung của `.mcp.json` vào file này.
5. Kiểm tra danh sách tools: các công cụ như `context7`, `sequential-thinking`, `playwright`, v.v. đã sẵn sàng để DeepSeek gọi.

---

## 4. Hướng Dẫn Prompting Cho DeepSeek Khi Dùng MCP

Khi yêu cầu DeepSeek viết code đồ họa, hãy gợi ý DeepSeek tận dụng các MCP:

### Ví dụ 1: Tra cứu Three.js r170+ bằng Context7
> *"DeepSeek, hãy dùng Context7 MCP tra cứu tài liệu mới nhất về `UnrealBloomPass` trong Three.js phiên bản r170 trở lên để cấu hình `threshold`, `strength`, và `radius` tối ưu nhất cho hiệu ứng neon glow của chòm sao."*

### Ví dụ 2: Viết GLSL Shader bằng Sequential Thinking
> *"DeepSeek, hãy dùng Sequential Thinking MCP để phân tích thuật toán toán học cho vòm trời Milky Way: tính toán tọa độ tia sáng (ray direction) từ camera, kết hợp 3 lớp Fractal Brownian Motion (FBM) để tạo dải mây tinh vân tím-xanh huyền ảo."*

### Ví dụ 3: Bắt lỗi Shader và đo FPS bằng Playwright MCP
> *"DeepSeek, hãy dùng Playwright MCP mở trình duyệt tới `http://localhost:5173`, theo dõi console log để kiểm tra xem shader của bạn có bị lỗi biên dịch GLSL (compile error) hay không và báo cáo số FPS."*
