import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { isOrderImageName } from "../src/orders/order-image-name.ts";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");

test("изображение модели ограничено типом и 5 МБ", () => {
  assert.match(service, /image\/jpeg/);
  assert.match(service, /MAX_SOURCE_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
});

test("изображение свыше 2 МБ преобразуется в качественный JPG", () => {
  assert.match(service, /OPTIMIZE_FROM_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(service, /\.rotate\(\)/);
  assert.match(service, /\.jpeg\(\{\s*quality:\s*88,\s*mozjpeg:\s*true\s*\}\)/);
  assert.match(service, /extension\s*=\s*"jpg"/);
});

test("заказ хранит изображение и независимые суммы", () => {
  assert.match(service, /modelImagePath:\s*dto\.modelImagePath/);
  assert.match(service, /depositRequiredMinor\s*>\s*dto\.priceMinor/);
});

test("маршрут изображения принимает ручные и импортированные имена без обхода пути", () => {
  assert.equal(isOrderImageName("550e8400-e29b-41d4-a716-446655440000.jpg"), true);
  assert.equal(isOrderImageName("keycrm-ed6cdcafccd7018bb5942e31bd6eac4b.jpg"), true);
  assert.equal(isOrderImageName("keycrm-ed6cdcafccd7018bb5942e31bd6eac4b.png"), false);
  assert.equal(isOrderImageName("../keycrm-ed6cdcafccd7018bb5942e31bd6eac4b.jpg"), false);
  assert.equal(isOrderImageName("keycrm-ed6cdcafccd7018bb5942e31bd6eac4b.jpg/extra"), false);
  assert.match(controller, /isOrderImageName\(name\)/);
});

test("API принимает разрешенную загрузку изображения до 5 МБ", () => {
  assert.match(main, /bodyParser:\s*false/);
  assert.match(main, /json\(\{\s*limit:\s*"8mb"/);
});

test("API требует nullable исходное изображение для защиты конкурентной замены", () => {
  assert.match(dto, /class UpdateOrderModelImageDto[\s\S]*@ApiProperty\(\{ nullable: true \}\)[^\n]*expectedModelImagePath!:/);
  assert.match(dto, /class UpdateOrderDetailsDto[\s\S]*@ApiProperty\(\{ nullable: true \}\)[^\n]*expectedModelImagePath!:/);
  assert.doesNotMatch(dto, /expectedModelImagePath\?:/);
});

test("API ограничивает цену заказа диапазоном Prisma Int", () => {
  assert.match(dto, /@Max\(2_147_483_647\) priceMinor!/);
  assert.match(dto, /@Max\(2_147_483_647\) expectedPriceMinor!/);
});
