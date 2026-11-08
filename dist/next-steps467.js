'use strict';
// Native workflow nodes and action areas already provide the document context.
// Retain the hook while removing the duplicated guidance panel.
window.NextSteps467={render(root){if(!root)return;root.querySelector('[data-nextsteps467]')?.remove();for(const n of root.querySelectorAll('.has-nextsteps467'))n.classList.remove('has-nextsteps467');}};
