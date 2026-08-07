import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

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

test("имя изображения защищено от обхода пути", () => {
  assert.match(controller, /\^\[a-f0-9-\]\+/);
});

test("API принимает разрешенную загрузку изображения до 5 МБ", () => {
  assert.match(main, /bodyParser:\s*false/);
  assert.match(main, /json\(\{\s*limit:\s*"8mb"/);
});
