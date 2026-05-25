export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    const groups = field.groups || [];
    const groupsJson = JSON.stringify(groups).replace(/'/g, '&#39;');
    const parentOptions = groups.map(g => `<option value="${g.value}">${g.label}</option>`).join('');
    return `
      <div class="field-group ${field.width || 'half'}" data-field="${id}">
        <label class="field-label" for="${id}_cat">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="cascading-dd-wrap">
          <div class="select-wrapper">
            <select id="${id}_cat" name="${id}_cat" class="field-select"
              onchange="window.cascadingDDChange(this)"
              data-target="${id}"
              data-groups='${groupsJson}'>
              <option value="">Select category</option>
              ${parentOptions}
            </select>
          </div>
          <div class="select-wrapper">
            <select id="${id}" name="${id}" class="field-select cascading-child" disabled ${field.required ? 'required' : ''}
              onchange="window.assetSubTypeChanged && window.assetSubTypeChanged(this)">
              <option value="">Select type</option>
            </select>
          </div>
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
