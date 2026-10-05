# vRich ↔ JST Stock Matching V2 (Excel-only Web App)

Static Web App สำหรับสร้าง `vrich_import_update_qty.xlsx` จากไฟล์ Excel โดยประมวลผลทั้งหมดใน browser ของผู้ใช้ ไม่มี backend, API หรือการอัปโหลดไฟล์ขึ้นเซิร์ฟเวอร์

## V2 แก้อะไร

1. ใช้ `JST Item -> จํานวนที่ใช้ได้` เป็นสต๊อกพร้อมขาย แทนการใช้ `จำนวน` รวม
2. รองรับ JST Combo/Set จากไฟล์ `SkuCombine...xlsx`
3. ไฟล์รหัสที่ผู้ใช้ส่งยังเป็น **Scope / Whitelist** ของรอบนั้น
4. รองรับ Family Expansion สำหรับรหัสไซซ์ เช่น `RU454XL -> RU454S/M/L/XL` เมื่อยืนยัน Family จากรหัสจริงใน vRich ได้
5. Component ของ Combo ใช้เพื่อคำนวณเท่านั้น ไม่ถูกแก้ใน vRich ถ้าไม่ได้อยู่ใน Scope เอง
6. Combo จะถูกบล็อกเป็นค่าเริ่มต้นถ้า Component เดียวกันยังมี stock exposure ใน vRich ไม่ว่าจะขายเป็นสินค้าเดี่ยวหรือถูกใช้ใน Combo อื่น เพื่อลด double counting
7. รหัสที่พบทั้งใน JST Item และ JST Combo จะถูกบล็อกเป็น `AMBIGUOUS_SOURCE` แทนการเดา
8. JST Available ติดลบจะถูก clamp เป็น 0 สำหรับไฟล์ import แต่เก็บคำเตือนไว้ใน Audit

## ไฟล์ที่ต้องใช้ 4 ไฟล์

1. **vRich master** เช่น `stock_20261005184700.xlsx`
2. **JST Item** เช่น `Item20261005194552116.xlsx`
3. **JST Combo/Set** เช่น `SkuCombine20261005195210822.xlsx`
4. **ไฟล์รหัสที่ต้องการปรับ** เช่น `sold_today.xlsx` ที่มีคอลัมน์ `รหัสสินค้า`

ค่าเริ่มต้นของคอลัมน์:

```text
TARGET_CODE_COLUMN       = รหัสสินค้า
VRICH_MATCH_COLUMN       = รหัสขาย
VRICH_QTY_COLUMN         = จำนวน
JST_MATCH_COLUMN         = รหัสรูปแบบ
JST_PHYSICAL_QTY_COLUMN  = จำนวน
JST_AVAILABLE_QTY_COLUMN = จํานวนที่ใช้ได้
COMBO_CODE_COLUMN        = รหัสรูปแบบคอมโบเซ็ต
COMBO_COMPONENT_COLUMN   = รหัสสินค้า
COMBO_REQUIRED_QTY       = จำนวน
```

## กฎ Scope

ไฟล์รหัสที่ผู้ใช้ส่งเป็นตัวกำหนดว่า “รอบนี้อนุญาตให้ระบบปรับอะไร”

- Exact code: ปรับเฉพาะรหัสนั้น
- Family code: หากเปิด Family Expansion และระบบยืนยัน Family จากข้อมูลจริงได้ ระบบจะขยายเฉพาะสมาชิก Family ที่มีอยู่จริงใน vRich
- Combo: ระบบอ่าน Component ใน JST เพื่อคำนวณ แต่ไม่เพิ่ม Component เข้า Output Scope อัตโนมัติ

ตัวอย่าง:

```text
Input: RU454XL
Scope after safe family expansion:
RU454S
RU454M
RU454L
RU454XL
```

```text
Input: A3112
Dependencies read only:
A2222 x1
A321  x1
A322  x1

Output Scope:
A3112 เท่านั้น
```

## สูตรสินค้าเดี่ยว

```text
vRich ใหม่ = MAX(0, FLOOR(JST จํานวนที่ใช้ได้))
```

`จำนวน` ของ JST เก็บไว้เพื่อ Audit เท่านั้น ไม่ใช้เป็นค่าที่ sync เข้า vRich

## สูตร Combo

```text
Combo Available = MIN(
  FLOOR(Component1 Available / Qty Required),
  FLOOR(Component2 Available / Qty Required),
  ...
)
```

### Shared Component

ค่าเริ่มต้นคือ `บล็อกไว้ก่อน (แนะนำ)` หาก Component เดียวกันยังขายเป็นสินค้าเดี่ยวใน vRich หรือถูกใช้โดย Combo อื่นที่ยังมี stock exposure ระบบจะไม่ใส่ Combo นั้นใน import จนกว่าจะตรวจสอบหรือยืนยันให้ข้าม

มีโหมด `คำนวณเชิงทฤษฎีและเตือน` สำหรับผู้ใช้ที่เข้าใจความเสี่ยง double counting แต่ไม่ใช่ค่าเริ่มต้น

## รายงานผลลัพธ์

- `vrich_import_update_qty.xlsx` — ไฟล์สำหรับ import เข้า vRich
- `summary_report.xlsx` — สรุปสถานะ
- `stock_audit_report.xlsx` — รายรหัส: Input, Scope, source, vRich เดิม, JST จำนวน, JST Available, จำนวนใหม่, Component, warning
- `scope_family_report.xlsx` — รายงาน Family Expansion
- `issues_report.xlsx` — รายการ missing / duplicate / shared component / ambiguous source / invalid data

## สถานะ

- `PASS` — ไม่มีปัญหาที่ค้างอยู่ พร้อมตรวจรายงานขั้นสุดท้าย
- `PASS_WITH_EXCLUSION` — ผ่านโดยมีรหัสที่ผู้ใช้ยืนยันให้ข้าม
- `FAIL` — มีรหัส/Component ที่หาไม่พบ
- `FAIL_DUPLICATE` — มีข้อมูลซ้ำที่กระทบ Scope
- `BLOCKED` — ระบบพบกรณีที่ไม่ควรเดา เช่น shared component หรือ ambiguous source

## วิธีใช้งาน

1. เปิด `index.html` หรือรัน static server
2. เลือกไฟล์ทั้ง 4 ไฟล์
3. กด **ตรวจสอบไฟล์**
4. กด **ประมวลผล**
5. ตรวจส่วน **Scope / Family Expansion**
6. ตรวจ **รายการที่ระบบบล็อกหรือควรตรวจ**
7. ดาวน์โหลดและเปิด `stock_audit_report.xlsx`
8. ตรวจ `vrich_import_update_qty.xlsx`
9. เมื่อมั่นใจแล้วจึง import เข้า vRich ด้วยตัวเอง

รัน local server ได้ด้วย:

```bash
python -m http.server 8000
```

## ไฟล์ที่ใช้บน GitHub Pages

```text
index.html
app.js
stock-engine.js
style.css
README.md
assets/cat-typing.lottie
vendor/xlsx.full.min.js
```

โฟลเดอร์ `tests/` ไม่จำเป็นต่อ runtime แต่เก็บไว้ใช้ regression test ได้

## Regression test

ถ้ามี Node.js:

```bash
node tests/stock-engine.test.js
```

## ห้าม commit ข้อมูลจริง

ห้าม commit Excel/CSV/TSV จริงของบริษัทหรือ report ที่สร้างจากข้อมูลจริง เช่น:

```text
*.xlsx
*.xls
*.xlsm
*.csv
*.tsv
```

## หมายเหตุเรื่องไฟล์ใหญ่

- > 30 MB: แสดงคำเตือน
- > 80 MB: block เพื่อป้องกัน browser ใช้หน่วยความจำเกิน

ระบบยังคงเป็น Excel-only และประมวลผลในเครื่องผู้ใช้ทั้งหมด
