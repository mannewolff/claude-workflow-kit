<template>
  <div class="legal-footer">
    <a href="https://mwolff.org/impressum" target="_blank" rel="noopener">Impressum</a>
    <span aria-hidden="true">·</span>
    <a href="https://mwolff.org/datenschutz" target="_blank" rel="noopener">Datenschutz</a>
  </div>
</template>

<style scoped>
.legal-footer {
  padding: 16px 24px 24px;
  text-align: center;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.legal-footer a {
  color: var(--vp-c-text-2);
  text-decoration-line: underline;
  text-underline-offset: 2px;
}

.legal-footer a:hover {
  color: var(--vp-c-brand-1);
}

.legal-footer span {
  margin: 0 8px;
}
</style>
