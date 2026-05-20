const URL_REGEX = /^(https?:\/\/)?([\w-]+(\.[\w-]+)+)(\/[\w\-./?%&=]*)?$/i;

export default {
  render(field, prefix = '') {
    const id = prefix + field.name;
    return `
      <div class="field-group ${field.width || 'full'}" data-field="${id}">
        <label class="field-label" for="${id}">
          ${field.label}${field.required ? '<span class="required">*</span>' : ''}
        </label>
        <div class="url-wrapper" id="${id}-wrapper">
          <span class="url-prefix">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </span>
          <input
            type="url"
            id="${id}"
            name="${id}"
            class="url-input"
            placeholder="${field.placeholder || 'https://'}"
            ${field.required ? 'required' : ''}
          />
        </div>
        <span class="field-error" id="${id}-error"></span>
      </div>`;
  },

  validate(value, field) {
    if (!value && field.required) return `${field.label} is required`;
    if (value && !URL_REGEX.test(value)) return 'Please enter a valid URL';
    return null;
  },

  getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
};
