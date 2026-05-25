export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const options = (field.options || [])
      .map(o => `<option value="${o.value}">${o.label}</option>`)
      .join('');
    return `
      <div class="field-group ${field.width || 'half'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="select-wrapper">
          <select id="${id}" name="${id}" class="field-select" ${field.required ? 'required' : ''}${field.onchange ? ` onchange="${field.onchange}"` : ''}>
            <option value="">Select ${field.label}</option>
            ${options}
          </select>
        </div>
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
