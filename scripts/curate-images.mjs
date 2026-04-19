import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const IMG_DIR = path.join(ROOT, 'img');
const MANIFEST_PATH = path.join(IMG_DIR, '_manifest.json');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');

const RULES = [
  {
    id: 'kia-rio',
    type: 'cars',
    outputBase: 'kia-rio',
    match: asset =>
      asset.name === 'kia-rio-iv-1-6-at' ||
      includesAny(asset.oldUrl, ['kiarionew.jpg'])
  },
  {
    id: 'hyundai-solaris',
    type: 'cars',
    outputBase: 'hyundai-solaris',
    match: asset =>
      asset.name === 'hyundai-solaris-1-6-at-sedan-2021' ||
      includesAny(asset.oldUrl, ['solaris2021s.png'])
  },
  {
    id: 'skoda-rapid',
    type: 'cars',
    outputBase: 'skoda-rapid',
    match: asset =>
      asset.name === 'skoda-rapid-1-6-at-liftback' ||
      includesAny(asset.oldUrl, ['skodarapidnew.jpg'])
  },
  {
    id: 'volkswagen-polo',
    type: 'cars',
    outputBase: 'volkswagen-polo',
    match: asset =>
      asset.name === 'volkswagen-polo-1-6-at-liftback-2023' ||
      includesAny(asset.oldUrl, ['polo23.png'])
  },
  {
    id: 'moskvich-3',
    type: 'cars',
    outputBase: 'moskvich-3',
    match: asset =>
      asset.name === 'moskvich-3-1-5t-cvt-136-l-s' ||
      includesAny(asset.oldUrl, ['moskvich3.webp'])
  },
  {
    id: 'changan-eado-plus',
    type: 'cars',
    outputBase: 'changan-eado-plus',
    match: asset =>
      asset.name === 'changan-eado-plus-dlx-1-4-155-l-s' ||
      includesAny(asset.oldUrl, ['changaneado.webp'])
  },
  {
    id: 'changan-lamora',
    type: 'cars',
    outputBase: 'changan-lamora',
    match: asset =>
      asset.name === 'changan-lamora' ||
      includesAny(asset.oldUrl, ['changanlamora.webp'])
  },
  {
    id: 'logo-main',
    type: 'common',
    outputBase: 'logo-main',
    match: asset =>
      includesAny(asset.oldUrl, ['logosabor200black.png']) ||
      asset.name === 'kompaniya-sabor-7-912-882-15-36-342-2-770-770-perm-ul',
    keepLargestOnly: true
  },
  {
    id: 'logo-small',
    type: 'common',
    outputBase: 'logo-small',
    match: asset =>
      includesAny(asset.oldUrl, ['logosabor48black.png']) ||
      asset.name === 'sabor-prokat-i-arenda-avtomobilei-v-permi',
    keepLargestOnly: true
  },
  {
    id: 'rent-hero',
    type: 'common',
    outputBase: 'rent-hero',
    match: asset =>
      includesAny(asset.oldUrl, ['perm-gto.jpg']) ||
      asset.name === 'perm-prokat-avto'
  },
  {
    id: 'contacts-image',
    type: 'common',
    outputBase: 'contacts-image',
    match: asset =>
      includesAny(asset.oldUrl, ['sabormar.png']) ||
      asset.name === 'kompaniya-sabor'
  },
  {
    id: 'telegram',
    type: 'common',
    outputBase: 'telegram',
    match: asset =>
      includesAny(asset.oldUrl, ['buttontelegram.png']) ||
      asset.name === 'telegram-saborauto-arenda-i-prokat-avtomobilei-v-permi',
    keepLargestOnly: true
  },
  {
    id: 'viber',
    type: 'common',
    outputBase: 'viber',
    match: asset =>
      includesAny(asset.oldUrl, ['buttonviber.png']) ||
      asset.name === 'viber-saborauto-arenda-i-prokat-avtomobilei-v-permi',
    keepLargestOnly: true
  },
  {
    id: 'whatsapp',
    type: 'common',
    outputBase: 'whatsapp',
    match: asset =>
      includesAny(asset.oldUrl, ['buttonwhatsapp.png']) ||
      asset.name === 'whatsapp-saborauto-arenda-i-prokat-avtomobilei-v-permi',
    keepLargestOnly: true
  }
];

await main();

async function main() {
  const manifest = await readJson(MANIFEST_PATH);
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  const plan = buildPlan(assets);
  printPlan(plan);

  if (!APPLY) {
    console.log('\nDRY RUN. Ничего не изменено.');
    console.log('Для применения: node ./scripts/curate-images.mjs --apply');
    return;
  }

  await applyPlan(plan);
  console.log('\nГотово.');
}

function buildPlan(assets) {
  const selected = [];
  const missing = [];

  for (const rule of RULES) {
    const asset = assets.find(a => rule.match(a));
    if (!asset) {
      missing.push(rule.id);
      continue;
    }

    const item = createPlannedItem(rule, asset);
    selected.push(item);
  }

  const keepPaths = new Set(
    selected.flatMap(item => item.files.map(file => normalizePath(file.sourceRelPath)))
  );

  return {
    selected,
    missing,
    keepPaths
  };
}

function createPlannedItem(rule, asset) {
  const variants = Array.isArray(asset.variants) ? asset.variants : [];
  const src = asset.src || '';
  const ext = (asset.ext || '.webp').toLowerCase();

  if (ext === '.svg') {
    const sourceRelPath = pathFromManifestPath(src);
    return {
      id: rule.id,
      type: rule.type,
      outputBase: rule.outputBase,
      sourceName: asset.name,
      oldUrl: asset.oldUrl,
      files: [
        {
          sourceRelPath,
          outputRelPath: buildOutputPath(rule.type, `${rule.outputBase}.svg`)
        }
      ]
    };
  }

  let files = [];

  if (rule.keepLargestOnly) {
    const largest = pickLargestVariant(asset, variants, src);
    if (!largest) {
      throw new Error(`Не найден ни один файл для ${rule.id}`);
    }

    files.push({
      sourceRelPath: pathFromManifestPath(largest.path),
      outputRelPath: buildOutputPath(rule.type, `${rule.outputBase}.webp`)
    });
  } else if (rule.type === 'cars') {
    const responsive = normalizeVariants(asset, variants, src);

    for (const item of responsive) {
      const width = item.width ? String(item.width) : '';
      if (!width) continue;

      files.push({
        sourceRelPath: pathFromManifestPath(item.path),
        outputRelPath: buildOutputPath(rule.type, `${rule.outputBase}-${width}.webp`)
      });
    }
  } else {
    const responsive = normalizeVariants(asset, variants, src);
    for (const item of responsive) {
      const width = item.width ? String(item.width) : '';
      const filename = width
        ? `${rule.outputBase}-${width}.webp`
        : `${rule.outputBase}.webp`;

      files.push({
        sourceRelPath: pathFromManifestPath(item.path),
        outputRelPath: buildOutputPath(rule.type, filename)
      });
    }
  }

  files = uniqueBy(files, item => `${item.sourceRelPath}=>${item.outputRelPath}`);

  return {
    id: rule.id,
    type: rule.type,
    outputBase: rule.outputBase,
    sourceName: asset.name,
    oldUrl: asset.oldUrl,
    files
  };
}

function normalizeVariants(asset, variants, src) {
  const items = Array.isArray(variants) && variants.length
    ? variants
    : [{ path: src, width: asset.width || '' }];

  return items
    .map(item => ({
      path: item.path || src,
      width: Number(item.width) || 0
    }))
    .filter(item => !!item.path)
    .sort((a, b) => a.width - b.width);
}

function pickLargestVariant(asset, variants, src) {
  const items = normalizeVariants(asset, variants, src);
  return items[items.length - 1] || null;
}

async function applyPlan(plan) {
  const stamp = timestamp();
  const backupDir = path.join(ROOT, `_img-backup-${stamp}`);
  const tempRoot = path.join(ROOT, `_img-temp-${stamp}`);
  const tempImg = path.join(tempRoot, 'img');
  const tempCars = path.join(tempImg, 'cars');
  const tempCommon = path.join(tempImg, 'common');

  await ensureDir(tempCars);
  await ensureDir(tempCommon);

  const curatedManifest = {
    generatedAt: new Date().toISOString(),
    sourceManifest: 'img/_manifest.json',
    selected: []
  };

  for (const item of plan.selected) {
    const manifestEntry = {
      id: item.id,
      type: item.type,
      outputBase: item.outputBase,
      sourceName: item.sourceName,
      oldUrl: item.oldUrl,
      files: []
    };

    for (const file of item.files) {
      const sourceAbs = path.join(ROOT, file.sourceRelPath);
      const targetAbs = path.join(ROOT, file.outputRelPath);

      await assertExists(sourceAbs);
      await ensureDir(path.dirname(path.join(tempRoot, file.outputRelPath)));
      await fs.copyFile(sourceAbs, path.join(tempRoot, file.outputRelPath));

      manifestEntry.files.push({
        source: file.sourceRelPath,
        output: file.outputRelPath
      });
    }

    curatedManifest.selected.push(manifestEntry);
  }

  await writeJson(path.join(tempImg, '_manifest-curated.json'), curatedManifest);

  await assertExists(IMG_DIR);
  await fs.rename(IMG_DIR, backupDir);
  await fs.rename(tempImg, IMG_DIR);
  await fs.rm(tempRoot, { recursive: true, force: true });

  console.log(`\nСтарая папка img сохранена в: ${path.relative(ROOT, backupDir)}`);
  console.log('Новая папка img собрана заново из отобранных файлов.');
}

function printPlan(plan) {
  console.log('Будут оставлены:');
  for (const item of plan.selected) {
    console.log(`\n- ${item.id} -> ${item.type}`);
    for (const file of item.files) {
      console.log(`  ${file.sourceRelPath} -> ${file.outputRelPath}`);
    }
  }

  if (plan.missing.length) {
    console.log('\nНе найдены правила:');
    for (const id of plan.missing) {
      console.log(`- ${id}`);
    }
  }
}

function buildOutputPath(type, filename) {
  const folder = type === 'cars' ? 'cars' : 'common';
  return path.join('img', folder, filename);
}

function pathFromManifestPath(value) {
  const raw = String(value || '').trim();
  const normalized = raw
    .replace(/^\/+/, '')
    .replaceAll('\\', '/');

  return normalized;
}

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function includesAny(value, fragments) {
  const source = String(value || '').toLowerCase();
  return fragments.some(fragment => source.includes(String(fragment).toLowerCase()));
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function assertExists(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Файл не найден: ${filePath}`);
  }
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}
