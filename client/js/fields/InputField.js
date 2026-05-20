export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    return `
      <div class="field-group ${field.width || 'full'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <input
          type="text"
          id="${id}"
          name="${id}"
          class="field-input"
          placeholder="${field.placeholder || ''}"
          ${field.required ? 'required' : ''}
          ${field.maxLength ? `maxlength="${field.maxLength}"` : ''}
        />
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (field.required && !String(value).trim()) return `${field.label} is required`;
    if (field.minLength && value.length < field.minLength) return `${field.label} must be at least ${field.minLength} characters`;
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
};
