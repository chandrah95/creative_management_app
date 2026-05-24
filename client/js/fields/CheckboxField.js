export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    return `
      <div class="field-group ${field.width || 'half'}" data-field="${id}">
        <label class="field-label">${field.label}</label>
        <label class="studio-toggle-wrap">
          <input type="checkbox" id="${id}" name="${id}" class="studio-checkbox">
          <span class="studio-toggle-track">
            <span class="studio-toggle-thumb"></span>
          </span>
          <span class="studio-toggle-label-on">Yes</span>
          <span class="studio-toggle-label-off">No</span>
        </label>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(_value, _field) {
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }
};
