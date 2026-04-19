const menu = document.querySelector('[data-menu]');
const toggle = document.querySelector('[data-menu-toggle]');

if (menu && toggle) {
  const mobileWidth = 760;

  const closeMenu = () => {
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const isMobile = () => window.innerWidth <= mobileWidth;

  toggle.addEventListener('click', () => {
    if (!isMobile()) return;
    const opened = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
  });

  menu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (event) => {
    if (!isMobile()) return;
    if (!menu.contains(event.target) && !toggle.contains(event.target)) {
      closeMenu();
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}
