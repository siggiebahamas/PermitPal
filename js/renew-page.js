// The public renewal guides (renew/): a live countdown to the deadline and the late-penalty estimate.
// The pages read fine without it; this only fills in the numbers.
import { maxPenalty } from './penalty.js';

const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const todayPH = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

document.querySelectorAll('[data-countdown]').forEach((el) => {
  const days = Math.round((Date.parse(el.dataset.countdown) - Date.parse(todayPH())) / 864e5);
  el.textContent = days > 1 ? `${days} days from today` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today'
    : 'This date has passed. If you haven\'t renewed yet, do it now: the interest grows every month.';
  if (days < 0) el.classList.add('late');
});

document.querySelectorAll('[data-penalty]').forEach((form) => {
  const set = (k, v) => { form.querySelector(`[data-v="${k}"]`).textContent = v; };
  const paint = () => {
    const base = Math.min(1e8, Math.max(0, Number(form.base.value) || 0));
    const p = maxPenalty(base, Number(form.months.value));
    set('surcharge', peso(p.surcharge));
    set('interest', peso(p.interest));
    set('total', peso(p.total));
    set('months', p.months === 1 ? '1 month' : `${p.months} months`);
  };
  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  form.addEventListener('submit', (e) => e.preventDefault());
  paint();
});
