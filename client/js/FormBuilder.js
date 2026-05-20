import { renderField, validateField, getFieldValue } from './fields/index.js';

// Expose numberStep globally so inline onclick handlers can reach it
window.numberStep = function (id, delta, min, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = Math.min(max, Math.max(min, (Number(el.value) || 0) + delta));
  el.value = next;
};

export function buildFields(fields, containerEl, prefix = '') {
  containerEl.innerHTML = fields.map(f => renderField(f, prefix)).join('');
}

export function collectValues(fields, prefix = '') {
  const values = {};
  fields.forEach(f => {
    values[f.name] = getFieldValue(f, prefix);
  });
  return values;
}

export function validateFields(fields, prefix = '') {
  let valid = true;
  fields.forEach(f => {
    const id = prefix + f.name;
    const value = getFieldValue(f, prefix);
    const error = validateField(f, value);
    const errEl = document.getElementById(`${id}-error`);
    const inputEl = document.getElementById(id) ||
                    document.querySelector(`[data-field="${id}"] .field-input`) ||
                    document.querySelector(`[data-field="${id}"] .field-select`) ||
                    document.querySelector(`[data-field="${id}"] .field-textarea`) ||
                    document.querySelector(`[data-field="${id}"] .url-input`) ||
                    document.querySelector(`[data-field="${id}"] .number-input`);

    if (error) {
      valid = false;
      if (errEl) errEl.textContent = error;
      if (inputEl) inputEl.classList.add('error');
    } else {
      if (errEl) errEl.textContent = '';
      if (inputEl) inputEl.classList.remove('error');
    }
  });
  return valid;
}

export function clearErrors(fields, prefix = '') {
  fields.forEach(f => {
    const id = prefix + f.name;
    const errEl = document.getElementById(`${id}-error`);
    if (errEl) errEl.textContent = '';
  });
}
