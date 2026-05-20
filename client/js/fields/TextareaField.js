export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const rows = field.rows || 4;
    return `
      <div class="field-group ${field.width || 'full'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <textarea
          id="${id}"
          name="${id}"
          class="field-textarea"
          rows="${rows}"
          placeholder="${field.placeholder || ''}"
          ${field.required ? 'required' : ''}
        ></textarea>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (field.required && !String(value).trim()) return `${field.label} is required`;
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
};
