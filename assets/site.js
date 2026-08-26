(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const header = document.querySelector('[data-header]');
  if (header) {
    const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 16);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  const revealElements = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    revealElements.forEach((element) => revealObserver.observe(element));
  }

  const featureTabs = Array.from(document.querySelectorAll('.feature-tab'));
  const featurePanel = document.getElementById('feature-screen');
  const featureImage = document.querySelector('[data-feature-image]');
  const imageCache = new Set([featureImage?.getAttribute('src')]);

  function activateFeature(tab, moveFocus = false) {
    if (!tab || !featureImage || !featurePanel) return;

    featureTabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });

    featurePanel.setAttribute('aria-labelledby', tab.id);
    const nextSource = tab.dataset.image;
    const nextAlt = tab.dataset.alt || '';

    if (nextSource && featureImage.getAttribute('src') !== nextSource) {
      featureImage.classList.add('is-loading');
      const preloader = new Image();
      preloader.onload = () => {
        featureImage.src = nextSource;
        featureImage.width = Number(tab.dataset.width) || 1179;
        featureImage.height = Number(tab.dataset.height) || 2556;
        featureImage.alt = nextAlt;
        featureImage.classList.remove('is-loading');
        imageCache.add(nextSource);
      };
      preloader.onerror = () => featureImage.classList.remove('is-loading');
      preloader.src = nextSource;
    } else {
      featureImage.alt = nextAlt;
    }

    if (moveFocus) tab.focus();
  }

  featureTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateFeature(tab));
    tab.addEventListener('pointerenter', () => {
      const source = tab.dataset.image;
      if (!source || imageCache.has(source)) return;
      const preloader = new Image();
      preloader.onload = () => imageCache.add(source);
      preloader.src = source;
    }, { once: true });
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % featureTabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + featureTabs.length) % featureTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = featureTabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      activateFeature(featureTabs[nextIndex], true);
    });
  });

  const pricingOptions = {
    weekly: {
      price: '$3.99',
      period: '/ week',
      note: 'Billed weekly. Cancel anytime.'
    },
    monthly: {
      price: '$9.99',
      period: '/ month',
      note: 'Billed monthly. Cancel anytime.'
    },
    annual: {
      price: '$99.99',
      period: '/ year',
      note: 'Billed annually — that’s $8.33 per month.'
    }
  };

  const priceButtons = Array.from(document.querySelectorAll('[data-price-cycle]'));
  const proPrice = document.querySelector('[data-pro-price]');
  const proPeriod = document.querySelector('[data-pro-period]');
  const proNote = document.querySelector('[data-pro-note]');

  priceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const option = pricingOptions[button.dataset.priceCycle];
      if (!option || !proPrice || !proPeriod || !proNote) return;

      priceButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });

      proPrice.textContent = option.price;
      proPeriod.textContent = option.period;
      proNote.textContent = option.note;
    });
  });

  const waitlistForm = document.querySelector('[data-waitlist-form]');
  const waitlistWrapper = document.getElementById('connect-wrap');
  const waitlistStatus = document.getElementById('connect-status');

  function setFormStatus(message, type = '') {
    if (!waitlistStatus) return;
    waitlistStatus.textContent = message;
    waitlistStatus.className = `form-status${type ? ` is-${type}` : ''}`;
  }

  if (waitlistForm && waitlistWrapper) {
    waitlistForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const emailInput = waitlistForm.elements.email;
      const honeypot = waitlistForm.elements.website;
      const button = waitlistForm.querySelector('button[type="submit"]');
      const buttonLabel = button?.querySelector('[data-button-label]');

      emailInput.setAttribute('aria-invalid', 'false');
      setFormStatus('');

      if (!emailInput.validity.valid) {
        emailInput.setAttribute('aria-invalid', 'true');
        setFormStatus('Enter a valid email address.', 'error');
        emailInput.focus();
        return;
      }

      const originalLabel = buttonLabel?.textContent || 'Keep me posted';
      if (button) button.disabled = true;
      if (buttonLabel) buttonLabel.textContent = 'Joining…';

      try {
        const response = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailInput.value,
            website: honeypot?.value || ''
          })
        });

        let data = {};
        try { data = await response.json(); } catch (_) { /* use the fallback below */ }

        if (response.status === 429) {
          throw new Error(data.error || 'Too many attempts. Please try again in a few minutes.');
        }
        if (!response.ok) {
          throw new Error(data.error || 'We could not add you right now. Please try again.');
        }

        waitlistWrapper.classList.add('is-complete');
        setFormStatus(data.message === 'Already subscribed'
          ? 'You’re already subscribed. Talk soon.'
          : 'You’re in. We’ll share what ships next.', 'success');
      } catch (error) {
        setFormStatus(error.message || 'Something went wrong. Please try again.', 'error');
        if (button) button.disabled = false;
        if (buttonLabel) buttonLabel.textContent = originalLabel;
      }
    });
  }
})();
