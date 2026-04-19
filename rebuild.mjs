import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const prices    = JSON.parse(readFileSync(join(__dirname, 'prices.json'), 'utf-8'));
let   template  = readFileSync(join(__dirname, 'template.html'), 'utf-8');

for (const [id, car] of Object.entries(prices)) {
  car.prices.forEach((price, i) => {
    template = template.replaceAll(`{{${id}_p${i + 1}}}`, price);
  });
  template = template.replaceAll(`{{${id}_km}}`,      car.km);
  template = template.replaceAll(`{{${id}_deposit}}`, car.deposit);
}

writeFileSync(join(__dirname, 'index.html'), template, 'utf-8');
console.log('✓ index.html пересобран');
