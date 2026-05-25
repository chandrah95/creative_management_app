export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const options = (field.options || []).map(o => `
        <label class="multiselect-option">
          <input type="checkbox" name="${id}" value="${o.value}" class="multiselect-cb">
          <span>${o.label}</span>
        </label>`).join('');
    return `
      <div class="field-group ${field.width || 'full'}" data-field="${id}">
        <label class="field-label">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="multiselect-wrap" id="${id}">
          ${options}
        </div>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (field.required && !value) return `At least one ${field.label} must be selected`;
    return null;
  },

  getValue(id) {
    const wrap = document.getElementById(id);
    if (!wrap) return '';
    const checked = wrap.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checked).map(c => c.value).join(',');
  }
};
