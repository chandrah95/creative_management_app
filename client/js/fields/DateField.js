export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const today = new Date().toISOString().split('T')[0];
    return `
      <div class="field-group ${field.width || 'half'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <input
          type="date"
          id="${id}"
          name="${id}"
          class="field-input"
          min="${field.min || today}"
          ${field.max ? `max="${field.max}"` : ''}
          ${field.required ? 'required' : ''}
        />
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (field.required && !value) return `${field.label} is required`;
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }
};
