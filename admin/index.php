<?php
// ============================================================
//  КОНФИГ
// ============================================================
const ALLOWED_IPS = ['95.31.252.148', '95.164.120.54', '127.0.0.1', '::1'];
const ADMIN_PIN     = '0580';
const SESSION_TTL   = 4 * 3600;
const MAX_FAILS     = 5;
const LOCKOUT_TTL   = 15 * 60;
const PRICES_FILE   = __DIR__ . '/../prices.json';
const TEMPLATE_FILE = __DIR__ . '/../template.html';
const OUTPUT_FILE   = __DIR__ . '/../index.html';
// ============================================================

session_start();

if (!in_array($_SERVER['REMOTE_ADDR'], ALLOWED_IPS)) {
    header('Location: /'); exit;
}

if (!empty($_SESSION['auth_at']) && time() - $_SESSION['auth_at'] > SESSION_TTL) {
    session_unset(); session_destroy(); session_start();
}

$locked    = !empty($_SESSION['lock_at']) && (time() - $_SESSION['lock_at']) < LOCKOUT_TTL;
$lock_left = $locked ? ceil((LOCKOUT_TTL - (time() - $_SESSION['lock_at'])) / 60) : 0;
$msg       = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    if (isset($_POST['logout'])) {
        session_unset(); session_destroy();
        header('Location: ' . $_SERVER['PHP_SELF']); exit;
    }

    if (isset($_POST['pin']) && empty($_SESSION['auth'])) {
        if ($locked) {
            $msg = "Подождите ещё {$lock_left} мин.";
        } elseif ($_POST['pin'] === ADMIN_PIN) {
            $_SESSION['auth']    = true;
            $_SESSION['auth_at'] = time();
            $_SESSION['fails']   = 0;
            unset($_SESSION['lock_at']);
        } else {
            sleep(2);
            $_SESSION['fails'] = ($_SESSION['fails'] ?? 0) + 1;
            if ($_SESSION['fails'] >= MAX_FAILS) {
                $_SESSION['lock_at'] = time();
                $msg = 'Заблокировано на 15 минут.';
            } else {
                $left = MAX_FAILS - $_SESSION['fails'];
                $msg  = "Неверный PIN. Осталось попыток: {$left}";
            }
        }
    }

    if (isset($_POST['data']) && !empty($_SESSION['auth'])) {
        $posted = json_decode($_POST['data'], true);
        $cars   = json_decode(file_get_contents(PRICES_FILE), true);

        foreach ($posted as $id => $vals) {
            if (!isset($cars[$id])) continue;
            foreach ($vals['prices'] as $i => $v) {
                $cars[$id]['prices'][$i] = max(0, (int)$v);
            }
            $cars[$id]['km']      = max(0, (int)$vals['km']);
            $cars[$id]['deposit'] = max(0, (int)$vals['deposit']);
        }

        file_put_contents(PRICES_FILE, json_encode($cars, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $html = file_get_contents(TEMPLATE_FILE);
        foreach ($cars as $id => $car) {
            foreach ($car['prices'] as $i => $price) {
                $html = str_replace('{{' . $id . '_p' . ($i + 1) . '}}', $price, $html);
            }
            $html = str_replace('{{' . $id . '_km}}',      $car['km'],      $html);
            $html = str_replace('{{' . $id . '_deposit}}', $car['deposit'], $html);
        }
        file_put_contents(OUTPUT_FILE, $html);

        echo 'ok'; exit;
    }
}

$auth = !empty($_SESSION['auth']);
$cars = json_decode(file_get_contents(PRICES_FILE), true);
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Редактор цен</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f0f2f5; color: #1a1a1a; -webkit-tap-highlight-color: transparent; }

.pin-wrap { display:flex; align-items:center; justify-content:center; min-height:100vh; }
.pin-box  { background:#fff; border-radius:20px; padding:40px 28px;
            width:320px; text-align:center; box-shadow:0 8px 32px rgba(0,0,0,.1); }
.pin-box h2   { font-size:20px; margin-bottom:24px; }
.pin-input    { width:100%; font-size:32px; text-align:center; letter-spacing:14px;
                border:2px solid #e5e7eb; border-radius:14px; padding:14px 8px;
                outline:none; transition:border-color .2s; }
.pin-input:focus { border-color:#2563eb; }
.pin-submit   { margin-top:14px; width:100%; background:#2563eb; color:#fff;
                font-size:18px; font-weight:600; border:none; border-radius:14px;
                padding:15px; cursor:pointer; }
.pin-submit:active { background:#1d4ed8; }
.err { color:#dc2626; font-size:14px; margin-top:12px; min-height:20px; }

.panel  { max-width:560px; margin:0 auto; padding:14px; }
header  { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
header h1 { font-size:18px; font-weight:700; }
.logout   { font-size:13px; color:#6b7280; background:none; border:none; cursor:pointer; text-decoration:underline; }

.car-card   { background:#fff; border-radius:16px; margin-bottom:10px;
              box-shadow:0 2px 8px rgba(0,0,0,.06); overflow:hidden; }
.car-head   { display:flex; justify-content:space-between; align-items:center;
              padding:15px 16px; cursor:pointer; user-select:none; }
.car-head h3 { font-size:15px; font-weight:600; }
.arrow      { color:#9ca3af; font-size:12px; transition:transform .2s; }
.arrow.open { transform:rotate(180deg); }
.car-body   { padding:0 16px 14px; display:none; }
.car-body.open { display:block; }

.price-row  { display:flex; align-items:center; justify-content:space-between;
              padding:9px 0; border-bottom:1px solid #f3f4f6; }
.price-row:last-child { border-bottom:none; }
.p-label    { font-size:13px; color:#4b5563; flex:1; padding-right:8px; line-height:1.3; }
.stepper    { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.s-btn      { width:38px; height:38px; border-radius:10px; border:none; font-size:22px;
              background:#f3f4f6; color:#111; cursor:pointer; touch-action:none;
              display:flex; align-items:center; justify-content:center; font-weight:300;
              -webkit-user-select:none; }
.s-btn:active { background:#e5e7eb; }
.s-val      { min-width:58px; text-align:center; font-size:16px; font-weight:700; }

.save-wrap { position:sticky; bottom:14px; padding-top:6px; }
.save-btn  { width:100%; background:#16a34a; color:#fff; font-size:18px; font-weight:700;
             border:none; border-radius:16px; padding:17px;
             box-shadow:0 4px 16px rgba(22,163,74,.4); cursor:pointer; }
.save-btn:active { background:#15803d; }
.save-btn.saving { background:#9ca3af; }

.toast { position:fixed; top:20px; left:50%; transform:translateX(-50%) translateY(-8px);
         background:#16a34a; color:#fff; padding:11px 28px; border-radius:50px;
         font-size:15px; opacity:0; transition:opacity .25s, transform .25s;
         pointer-events:none; z-index:999; white-space:nowrap; }
.toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
</style>
</head>
<body>

<?php if (!$auth): ?>

<div class="pin-wrap">
  <div class="pin-box">
    <h2>🔑 SABOR — управление</h2>
    <form method="post" autocomplete="off">
      <input class="pin-input" type="password" inputmode="numeric"
             name="pin" maxlength="8" autofocus placeholder="••••">
      <button class="pin-submit" type="submit">Войти</button>
      <p class="err"><?= htmlspecialchars($msg) ?></p>
    </form>
  </div>
</div>

<?php else: ?>

<div class="panel">
  <header>
    <h1>Цены SABOR</h1>
    <form method="post">
      <button class="logout" name="logout" value="1" type="submit">Выйти</button>
    </form>
  </header>

  <?php foreach ($cars as $id => $car): ?>
  <div class="car-card">
    <div class="car-head" onclick="toggleCar('<?= $id ?>')">
      <h3><?= htmlspecialchars($car['label']) ?></h3>
      <span class="arrow" id="arr-<?= $id ?>">▼</span>
    </div>
    <div class="car-body" id="body-<?= $id ?>">

      <?php foreach ($car['periods'] as $i => $period): ?>
      <div class="price-row">
        <span class="p-label"><?= htmlspecialchars($period) ?></span>
        <div class="stepper">
          <button class="s-btn" data-id="<?= "{$id}_p" . ($i+1) ?>" data-dir="-1">−</button>
          <span class="s-val" id="<?= "{$id}_p" . ($i+1) ?>"><?= $car['prices'][$i] ?></span>
          <button class="s-btn" data-id="<?= "{$id}_p" . ($i+1) ?>" data-dir="1">+</button>
        </div>
      </div>
      <?php endforeach; ?>

      <div class="price-row">
        <span class="p-label">1 км свыше лимита</span>
        <div class="stepper">
          <button class="s-btn" data-id="<?= $id ?>_km" data-dir="-1">−</button>
          <span class="s-val" id="<?= $id ?>_km"><?= $car['km'] ?></span>
          <button class="s-btn" data-id="<?= $id ?>_km" data-dir="1">+</button>
        </div>
      </div>

      <div class="price-row">
        <span class="p-label">Залог</span>
        <div class="stepper">
          <button class="s-btn" data-id="<?= $id ?>_deposit" data-dir="-1">−</button>
          <span class="s-val" id="<?= $id ?>_deposit"><?= $car['deposit'] ?></span>
          <button class="s-btn" data-id="<?= $id ?>_deposit" data-dir="1">+</button>
        </div>
      </div>

    </div>
  </div>
  <?php endforeach; ?>

  <div class="save-wrap">
    <button class="save-btn" id="saveBtn" onclick="saveAll()">Сохранить</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const CARS = <?= json_encode($cars, JSON_UNESCAPED_UNICODE) ?>;

function getStep(id) {
    if (id.endsWith('_km'))      return 1;
    if (id.endsWith('_deposit')) return 500;
    return 50;
}

document.querySelectorAll('.s-btn').forEach(btn => {
    const dir = parseInt(btn.dataset.dir);
    let timer = null, speed = 400, count = 0;

    function doStep() {
        const id  = btn.dataset.id;
        const el  = document.getElementById(id);
        const val = Math.max(0, parseInt(el.textContent) + dir * getStep(id));
        el.textContent = val;
    }

    function schedule() {
        timer = setTimeout(() => {
            doStep();
            count++;
            if (count % 4 === 0 && speed > 80) speed = Math.max(80, speed - 70);
            schedule();
        }, speed);
    }

    function start(e) { e.preventDefault(); doStep(); speed = 400; count = 0; schedule(); }
    function stop()   { clearTimeout(timer); timer = null; speed = 400; count = 0; }

    btn.addEventListener('mousedown',   start);
    btn.addEventListener('touchstart',  start, { passive: false });
    btn.addEventListener('mouseup',     stop);
    btn.addEventListener('mouseleave',  stop);
    btn.addEventListener('touchend',    stop);
    btn.addEventListener('touchcancel', stop);
});

function toggleCar(id) {
    document.getElementById('body-' + id).classList.toggle('open');
    document.getElementById('arr-'  + id).classList.toggle('open');
}

function saveAll() {
    const btn = document.getElementById('saveBtn');
    btn.classList.add('saving');
    btn.textContent = 'Сохранение...';

    const data = {};
    for (const id in CARS) {
        const car = CARS[id];
        data[id] = { prices: [], km: 0, deposit: 0 };
        car.prices.forEach((_, i) => {
            data[id].prices.push(parseInt(document.getElementById(id + '_p' + (i + 1)).textContent));
        });
        data[id].km      = parseInt(document.getElementById(id + '_km').textContent);
        data[id].deposit = parseInt(document.getElementById(id + '_deposit').textContent);
    }

    const form = new FormData();
    form.append('data', JSON.stringify(data));

    fetch(location.href, { method: 'POST', body: form })
        .then(r => r.text())
        .then(res => {
            btn.classList.remove('saving');
            btn.textContent = 'Сохранить';
            showToast(res === 'ok' ? 'Сохранено ✓' : 'Ошибка: ' + res);
        })
        .catch(() => {
            btn.classList.remove('saving');
            btn.textContent = 'Сохранить';
            showToast('Ошибка соединения');
        });
}

function showToast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}
</script>

<?php endif; ?>
</body>
</html>
