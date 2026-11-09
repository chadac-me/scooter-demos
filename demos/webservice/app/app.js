// Renders the shipments table and the summary cards from window.SHIPMENTS.
const COLUMNS = [
  { key: "id", label: "Shipment" },
  { key: "customer", label: "Customer" },
  { key: "route", label: "Route" },
  { key: "carrier", label: "Carrier" },
  { key: "status", label: "Status" },
  { key: "eta", label: "ETA" },
];

const slug = (s) => s.toLowerCase().replace(/\s+/g, "-");

function cell(row, key) {
  if (key === "status") return `<span class="badge badge-${slug(row.status)}">${row.status}</span>`;
  if (key === "id") return `<span class="mono">${row.id}</span>`;
  return row[key];
}

function render() {
  const head = document.querySelector("#shipments thead tr");
  head.innerHTML = COLUMNS.map((c) => `<th data-col="${c.key}">${c.label}</th>`).join("");
  const body = document.querySelector("#shipments tbody");
  body.innerHTML = window.SHIPMENTS.map(
    (row) => `<tr data-id="${row.id}">${COLUMNS.map((c) => `<td data-col="${c.key}">${cell(row, c.key)}</td>`).join("")}</tr>`,
  ).join("");

  const counts = {};
  for (const row of window.SHIPMENTS) counts[row.status] = (counts[row.status] ?? 0) + 1;
  document.getElementById("summary").innerHTML = ["In transit", "At port", "Delayed", "Delivered"]
    .map((s) => `<div class="card card-${slug(s)}"><span class="count">${counts[s] ?? 0}</span><span class="label">${s}</span></div>`)
    .join("");
}

render();
