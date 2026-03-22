// Shared UI helper functions

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function formatRate(value) {
  if (Math.abs(value) < 0.01) return "0";
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  return value.toFixed(2);
}

export function goodName(good) {
  if (!good) return "?";
  return good.displayName || good.id;
}

export function recipeName(recipe) {
  if (!recipe) return "?";
  return recipe.displayName || recipe.id;
}

export function buildingName(building) {
  if (!building) return "?";
  return building.displayName || building.id;
}

export function naturalResourceName(resource) {
  if (!resource) return "?";
  return resource.displayName || resource.id;
}

/**
 * Create an HTML table from rows of data.
 * columns: [{ header: string, cell: (row) => string }]
 */
/**
 * Wrap all input[type="number"] within a container with custom +/- buttons.
 * Skips inputs that are already wrapped.
 */
export function wrapNumberInputs(container, { vertical = false } = {}) {
  for (const input of container.querySelectorAll('input[type="number"]')) {
    if (input.parentElement.classList.contains("number-input-wrap")) continue;

    const wrap = document.createElement("div");
    wrap.className = "number-input-wrap" + (vertical ? " vertical" : "");

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "spin-btn";
    dec.textContent = "\u2212";
    dec.tabIndex = -1;

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "spin-btn";
    inc.textContent = "+";
    inc.tabIndex = -1;

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(dec);
    wrap.appendChild(input);
    wrap.appendChild(inc);

    const step = parseFloat(input.step) || 1;
    const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
    const max = input.max !== "" ? parseFloat(input.max) : Infinity;

    dec.addEventListener("click", () => {
      const val = parseFloat(input.value) || 0;
      input.value = Math.max(min, +(val - step).toFixed(4));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    inc.addEventListener("click", () => {
      const val = parseFloat(input.value) || 0;
      input.value = Math.min(max, +(val + step).toFixed(4));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

export function renderTable(columns, rows) {
  if (rows.length === 0) return "<p class='placeholder'>No results</p>";

  let html = "<table class='detail-table'><thead><tr>";
  for (const col of columns) {
    html += `<th>${escapeHtml(col.header)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (const col of columns) {
      html += `<td>${col.cell(row)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}
