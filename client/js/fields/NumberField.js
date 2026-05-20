export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const min = field.min ?? 0;
    const max = field.max ?? 9999;
    const def = field.default ?? min;
    return `
      <div class="field-group ${field.width || 'half'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="number-wrapper" id="${id}-wrapper">
          <button type="button" class="number-btn" onclick="numberStep('${id}', -1, ${min}, ${max})" tabindex="-1">−</button>
          <input
            type="number"
            id="${id}"
            name="${id}"
            class="number-input"
            value="${def}"
            min="${min}"
            max="${max}"
            ${field.required ? 'required' : ''}
          />
          <button type="button" class="number-btn" onclick="numberStep('${id}', 1, ${min}, ${max})" tabindex="-1">+</button>
        </div>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    const num = Number(value);
    if (field.required && value === '') return `${field.label} is required`;
    if (field.min !== undefined && num < field.min) return `${field.label} must be at least ${field.min}`;
    if (field.max !== undefined && num > field.max) return `${field.label} must be at most ${field.max}`;
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? Number(el.value) : 0;
  }
};
