# 🐺 Werewolf บนเว็บ

เกม Werewolf สำหรับเล่นพร้อมกันในห้องเดียวกัน คนหนึ่งเป็น Moderator ที่เหลือใช้มือถือของตัวเองเป็นการ์ด Role
กติกาอ้างอิง **Ultimate Werewolf** (Bézier Games)

## เริ่มใช้งาน (Docker)

```bash
docker compose up -d --build
```

เปิด `http://localhost:8080` (เปลี่ยนพอร์ตได้ด้วย `PORT=9000 docker compose up -d`)
ให้เพื่อนในวง Wi-Fi เดียวกันเข้า `http://<IP เครื่องคุณ>:8080`

| Service | หน้าที่ |
|---|---|
| `client` | React build เสิร์ฟผ่าน nginx และส่งต่อ WebSocket ไปที่ server |
| `server` | Node.js + Socket.IO กฎเกมทั้งหมด สุ่ม Role บนเซิร์ฟเวอร์ |
| `redis` | เก็บสถานะห้อง ถ้า server รีสตาร์ท เกมยังอยู่ (เก็บ 24 ชม.) |

หยุด: `docker compose down` · ล้างข้อมูล: `docker compose down -v`

## Deploy บน VPS (แนะนำ)

```bash
git clone https://github.com/nay9s/werewolf && cd werewolf
docker compose up -d --build                    # http://<IP>:8080
```

มีโดเมน? ชี้ A record มาที่ IP ของ VPS แล้วรัน (เปิดพอร์ต 80/443):

```bash
echo "DOMAIN=werewolf.example.com" > .env
docker compose --profile https up -d --build     # https://werewolf.example.com
```

อัปเดตเวอร์ชัน: `git pull && docker compose up -d --build`

## Deploy: หน้าเว็บบน Vercel + server บน Render

Vercel ไม่รองรับ WebSocket server ที่รันค้าง จึงแยกเป็น 2 ส่วน

1. **Server (Render ฟรี):** render.com → New → Blueprint → เลือก repo นี้ (ใช้ `render.yaml`) ได้ URL เช่น `https://werewolf-server.onrender.com`
2. **หน้าเว็บ (Vercel):** vercel.com → Add New Project → เลือก repo นี้
   - **Root Directory:** `client`
   - **Environment Variable:** `VITE_SERVER_URL` = URL ของ server จากข้อ 1
   - กด Deploy

หมายเหตุ: Render แผนฟรีจะหลับเมื่อไม่มีคนใช้ เปิดครั้งแรกรอ ~30 วิ และไม่มี Redis (ห้องหายเมื่อ server รีสตาร์ท)

## โหมดพัฒนา (ไม่ใช้ Docker)

```bash
cd server && npm install && npm run dev     # :3000 (ไม่มี REDIS_URL = เก็บในหน่วยความจำ)
cd client && npm install && npm run dev     # :5173
cd server && npm test                       # ทดสอบกฎเกม
```

## Roles

| Role | ฝั่ง | ความสามารถ |
|---|---|---|
| 🐺 หมาป่า | หมาป่า | ทุกคืนเลือกเหยื่อร่วมกับฝูง |
| 🐺🍼 ลูกหมาป่า | หมาป่า | ตื่นกับฝูง ถ้าตาย คืนถัดไปหมาป่ากัด 2 คน |
| 🏘️ ชาวบ้าน | ชาวบ้าน | ไม่มีพลัง (เติมอัตโนมัติ) |
| 🔮 หมอดู | ชาวบ้าน | ส่อง 1 คน/คืน รู้ว่าใช่หมาป่าไหม |
| 🛡️ บอดี้การ์ด | ชาวบ้าน | ป้องกัน 1 คน/คืน ห้ามซ้ำคนเดิมติดกัน ห้ามป้องกันตัวเอง (ตั้งค่าได้) |
| 🧙 แม่มด | ชาวบ้าน | ยาชุบ 1 + ยาพิษ 1 ต่อเกม คืนละขวด |
| 🏹 นายพราน | ชาวบ้าน | ตายแล้วยิงพาไป 1 คน |
| 💘 คิวปิด | ชาวบ้าน | คืนแรกจับคู่รัก ตายตามกัน |

## Flow

```
LOBBY → แจก Role (กดค้างดู) → คืน → เช้า → อภิปราย → โหวตลับ → ผล → (คืนถัดไป | จบเกม)
```

- **กลางคืน:** Moderator กด "เรียก" ทีละ Role ตามลำดับ คิวปิด → บอดี้การ์ด → หมาป่า → หมอดู → แม่มด
  จอของ Role นั้นสว่างให้เลือก คนอื่นเห็นจอมืด Role ที่ตายแล้วยังเรียกได้ เพื่อพรางข้อมูล
- **Moderator ไม่เห็น Role และไม่เห็นว่าใครเลือกใคร** (เปิดได้ในตั้งค่า) มีแผง 📝 มาร์ค ส่วนตัว
- **ชนะ:** ชาวบ้านเมื่อหมาป่าหมด · หมาป่าเมื่อหมาป่า ≥ คนที่เหลือ · ตายพร้อมกันหมด = หมาป่าชนะ

## โครงสร้าง

```
server/src/roles.ts     ข้อมูล Role (client/src/roles.ts เป็นสำเนา แก้ให้ตรงกัน)
server/src/game.ts      กฎเกมทั้งหมด + viewFor() ส่งข้อมูลเฉพาะที่แต่ละคนเห็นได้
server/src/index.ts     Socket.IO, timer, Redis
server/src/sim.test.ts  ทดสอบกฎ
client/src/App.tsx      หน้าจอทั้งหมด
```

## ข้อจำกัดตอนนี้

- คู่รักต่างฝ่ายยังใช้เงื่อนไขชนะตามฝ่ายตัวเอง (ยังไม่มีชัยชนะพิเศษของคู่รัก)
- ไม่มีแชทในเว็บ อภิปรายด้วยเสียงจริง
