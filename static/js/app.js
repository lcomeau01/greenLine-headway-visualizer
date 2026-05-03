const state = {
  metrics: [],
  selectedMetric: "mean_headway",
  selectedStationMetric: "mean_headway",
  selectedBranch: null,
  branches: [],
  timeOfDay: [],
  attendance: [],
  stations: {},
  resizeTimer: null,
  timePeriod: "all",
  dayType: "all"
};

const stationMetricMeta = {
  mean_headway: { label: "Mean" },
  median_headway: { label: "Median" },
  std_headway: { label: "Std Dev" },
  min_headway: { label: "Min" },
  max_headway: { label: "Max" }
};

const colors = new Map([
  ["Green-B", "#0b5d2a"],
  ["Green-C", "#2f8f3f"],
  ["Green-D", "#73bf44"],
  ["Green-E", "#a6d84f"]
]);

const alertSeverityByType = new Map([
  ["SUSPENSION", "Severe"],
  ["STATION_CLOSURE", "Severe"],
  ["SHUTTLE", "High"],
  ["DELAY", "High"],
  ["SERVICE_CHANGE", "Moderate"],
  ["ELEVATOR_CLOSURE", "Moderate"],
  ["ESCALATOR_CLOSURE", "Moderate"],
  ["STATION_ISSUE", "Moderate"],
  ["PARKING_CLOSURE", "Low"],
  ["PARKING_ISSUE", "Low"]
]);

const controls = {
  weather: document.querySelector("#weather"),
  windLevel: document.querySelector("#wind-level"),
  demandLevel: document.querySelector("#demand-level"),
  alertFilter: document.querySelector("#alert-filter"),
  minAlertSeverity: document.querySelector("#min-alert-severity"),
  maxAlertSeverity: document.querySelector("#max-alert-severity"),
  minTemperature: document.querySelector("#min-temperature"),
  maxTemperature: document.querySelector("#max-temperature"),
  minPrecipitation: document.querySelector("#min-precipitation"),
  maxPrecipitation: document.querySelector("#max-precipitation"),
  minSnow: document.querySelector("#min-snow"),
  maxSnow: document.querySelector("#max-snow"),
  reset: document.querySelector("#reset-filters"),
  apply: document.querySelector("#apply-filters")
};

const labels = {
  alert: document.querySelector("#alert-value"),
  temperatureMin: document.querySelector("#temperature-min"),
  temperatureMax: document.querySelector("#temperature-max"),
  precipitationMin: document.querySelector("#precipitation-min"),
  precipitationMax: document.querySelector("#precipitation-max"),
  snowMin: document.querySelector("#snow-min"),
  snowMax: document.querySelector("#snow-max"),
  sample: document.querySelector("#sample-size"),
  chartTitle: document.querySelector("#chart-title"),
  selectedBranchPill: document.querySelector("#selected-branch-pill"),
  detailTitle: document.querySelector("#detail-title"),
  stationTitle: document.querySelector("#station-title"),
  detailMean: document.querySelector("#detail-mean"),
  detailMedian: document.querySelector("#detail-median"),
  detailStd: document.querySelector("#detail-std"),
  detailMin: document.querySelector("#detail-min"),
  detailMax: document.querySelector("#detail-max")
};

const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

async function initialize() {
  const response = await fetch("/api/init");
  const data = await response.json();
  state.metrics = data.metrics;
  document.querySelector("#metric-tabs").innerHTML = data.metrics.map(metric => `<button type="button" data-metric="${metric.key}">${metric.label}</button>`).join("");
  data.alert_types.forEach(type => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = titleCase(type);
    controls.alertFilter.appendChild(option);
  });
  controls.minTemperature.min = Math.floor(data.ranges.min_temperature ?? -10);
  controls.minTemperature.max = Math.ceil(data.ranges.max_temperature ?? 100);
  controls.maxTemperature.min = controls.minTemperature.min;
  controls.maxTemperature.max = controls.minTemperature.max;
  controls.minPrecipitation.max = Math.max(0.1, data.ranges.max_precipitation ?? 3);
  controls.maxPrecipitation.max = controls.minPrecipitation.max;
  controls.minSnow.max = Math.max(0.1, data.ranges.max_snow ?? 12);
  controls.maxSnow.max = controls.minSnow.max;
  controls.minAlertSeverity.max = Math.max(10, data.ranges.max_alert_severity ?? 10);
  controls.maxAlertSeverity.max = controls.minAlertSeverity.max;
  bindControls();
  resetFilters(false);
  await updateFromFilters();
}

function bindControls() {
  document.querySelectorAll("#metric-tabs button").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedMetric = button.dataset.metric;
      render();
    });
  });
  document.querySelectorAll("#time-buttons button").forEach(button => {
    button.addEventListener("click", () => {
      state.timePeriod = button.dataset.value;
      setActive("#time-buttons", button);
    });
  });
  document.querySelectorAll("#day-buttons button").forEach(button => {
    button.addEventListener("click", () => {
      state.dayType = button.dataset.value;
      setActive("#day-buttons", button);
    });
  });
  document.querySelectorAll(".detail-stat").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedStationMetric = button.dataset.stationMetric;
      renderDetails();
      renderStationChart();
    });
  });
  [
    [controls.minTemperature, controls.maxTemperature],
    [controls.minPrecipitation, controls.maxPrecipitation],
    [controls.minSnow, controls.maxSnow],
    [controls.minAlertSeverity, controls.maxAlertSeverity]
  ].forEach(pair => {
    pair.forEach(control => {
      control.addEventListener("pointerdown", () => raiseRange(control));
      control.addEventListener("input", () => {
        normalizePair(pair[0], pair[1], control);
        updateLabels();
      });
    });
  });
  controls.weather.addEventListener("change", updateLabels);
  controls.alertFilter.addEventListener("change", updateLabels);
  controls.reset.addEventListener("click", () => resetFilters(true));
  controls.apply.addEventListener("click", updateFromFilters);
  window.addEventListener("resize", () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(render, 120);
  });
}

function raiseRange(control) {
  const pair = control.closest(".range-pair");
  if (!pair) {
    return;
  }
  pair.querySelectorAll('input[type="range"]').forEach((item, index) => {
    item.style.zIndex = item === control ? "100" : String(index + 90);
  });
}

function resetFilters(shouldFetch) {
  controls.weather.value = "all";
  controls.windLevel.value = "all";
  controls.demandLevel.value = "all";
  controls.alertFilter.value = "severity";
  controls.minAlertSeverity.value = controls.minAlertSeverity.min;
  controls.maxAlertSeverity.value = controls.maxAlertSeverity.max;
  controls.minTemperature.value = controls.minTemperature.min;
  controls.maxTemperature.value = controls.maxTemperature.max;
  controls.minPrecipitation.value = controls.minPrecipitation.min;
  controls.maxPrecipitation.value = controls.maxPrecipitation.max;
  controls.minSnow.value = controls.minSnow.min;
  controls.maxSnow.value = controls.maxSnow.max;
  state.selectedStationMetric = "mean_headway";
  state.timePeriod = "all";
  state.dayType = "all";
  document.querySelectorAll("#time-buttons button").forEach(button => button.classList.toggle("active", button.dataset.value === "all"));
  document.querySelectorAll("#day-buttons button").forEach(button => button.classList.toggle("active", button.dataset.value === "all"));
  updateLabels();
  if (shouldFetch) {
    updateFromFilters();
  }
}

function normalizePair(minControl, maxControl, changedControl) {
  if (Number(minControl.value) > Number(maxControl.value)) {
    if (changedControl === minControl) {
      maxControl.value = minControl.value;
    } else {
      minControl.value = maxControl.value;
    }
  }
}

function setActive(selector, activeButton) {
  document.querySelectorAll(`${selector} button`).forEach(button => button.classList.toggle("active", button === activeButton));
}

function updateLabels() {
  const weather = controls.weather.value;
  const precipitationActive = weather === "rain" || weather === "all";
  const snowActive = weather === "snow" || weather === "all";
  [controls.minPrecipitation, controls.maxPrecipitation].forEach(control => {
    control.disabled = !precipitationActive;
  });
  [controls.minSnow, controls.maxSnow].forEach(control => {
    control.disabled = !snowActive;
  });
  controls.minAlertSeverity.disabled = controls.alertFilter.value !== "severity";
  controls.maxAlertSeverity.disabled = controls.alertFilter.value !== "severity";
  controls.minPrecipitation.closest(".control-group").classList.toggle("disabled", !precipitationActive);
  controls.minSnow.closest(".control-group").classList.toggle("disabled", !snowActive);
  labels.alert.textContent = controls.alertFilter.value === "no_alert"
    ? "None"
    : controls.alertFilter.value === "severity"
      ? `${controls.minAlertSeverity.value} to ${controls.maxAlertSeverity.value}`
      : alertSeverityByType.get(controls.alertFilter.value) || "Moderate";
  labels.temperatureMin.textContent = `${controls.minTemperature.value}°F`;
  labels.temperatureMax.textContent = `${controls.maxTemperature.value}°F`;
  labels.precipitationMin.textContent = `${Number(controls.minPrecipitation.value).toFixed(2)} in`;
  labels.precipitationMax.textContent = `${Number(controls.maxPrecipitation.value).toFixed(2)} in`;
  labels.snowMin.textContent = `${Number(controls.minSnow.value).toFixed(1)} in`;
  labels.snowMax.textContent = `${Number(controls.maxSnow.value).toFixed(1)} in`;
}

function params() {
  const search = new URLSearchParams();
  search.set("weather", controls.weather.value);
  search.set("wind_level", controls.windLevel.value);
  search.set("demand_level", controls.demandLevel.value);
  search.set("time_period", state.timePeriod);
  search.set("day_type", state.dayType);
  search.set("alert_filter", controls.alertFilter.value);
  search.set("min_alert_severity", controls.minAlertSeverity.value);
  search.set("max_alert_severity", controls.maxAlertSeverity.value);
  if (controls.weather.value === "rain" || controls.weather.value === "all") {
    search.set("min_precipitation", controls.minPrecipitation.value);
    search.set("max_precipitation", controls.maxPrecipitation.value);
  }
  if (controls.weather.value === "snow" || controls.weather.value === "all") {
    search.set("min_snow", controls.minSnow.value);
    search.set("max_snow", controls.maxSnow.value);
  }
  if (controls.minTemperature.value !== controls.minTemperature.min) {
    search.set("min_temperature", controls.minTemperature.value);
  }
  if (controls.maxTemperature.value !== controls.maxTemperature.max) {
    search.set("max_temperature", controls.maxTemperature.value);
  }
  search.set("metric", state.selectedMetric);
  return search;
}

async function updateFromFilters() {
  controls.apply.disabled = true;
  controls.apply.textContent = "Loading";
  const response = await fetch(`/api/analytics?${params().toString()}`);
  const data = await response.json();
  state.branches = data.branches;
  state.timeOfDay = data.time_of_day;
  state.attendance = data.attendance;
  state.stations = data.stations;
  state.selectedBranch = state.branches.find(branch => branch.metrics[state.selectedMetric] !== null)?.branch ?? null;
  labels.sample.textContent = `${Number(data.sample_size).toLocaleString()} samples`;
  controls.apply.disabled = false;
  controls.apply.textContent = "Apply Filters";
  render();
}

function render() {
  updateMetricTabs();
  renderBarChart();
  renderTimeScatter();
  renderAttendanceScatter();
  renderDetails();
  renderStationChart();
}

function updateMetricTabs() {
  document.querySelectorAll("#metric-tabs button").forEach(button => {
    button.classList.toggle("active", button.dataset.metric === state.selectedMetric);
  });
}

function selectedMetricLabel() {
  return state.metrics.find(metric => metric.key === state.selectedMetric)?.label ?? "Mean";
}

function bestBranch() {
  return state.branches
    .filter(branch => branch.metrics[state.selectedMetric] !== null)
    .sort((a, b) => b.metrics[state.selectedMetric] - a.metrics[state.selectedMetric])[0];
}

function renderBarChart() {
  const svg = d3.select("#bar-chart");
  const node = svg.node();
  const width = node.clientWidth || 900;
  const height = node.clientHeight || 330;
  const margin = { top: 30, right: 26, bottom: 58, left: 26 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const data = state.branches.map(branch => ({
    branch: branch.branch,
    value: branch.metrics[state.selectedMetric],
    sampleSize: branch.metrics.sample_size
  })).filter(item => item.value !== null);

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  labels.chartTitle.textContent = `${selectedMetricLabel()} Headway by Branch`;

  if (!data.length) {
    svg.append("text").attr("class", "empty").attr("x", width / 2).attr("y", height / 2).text("No data for selected conditions");
    return;
  }

  const x = d3.scaleBand().domain(data.map(d => d.branch)).range([0, innerWidth]).padding(0.32);
  const maxValue = d3.max(data, d => d.value) ?? 0;
  const allZero = maxValue <= 0;
  const y = d3.scaleLinear().domain([0, allZero ? 1 : maxValue * 1.28]).nice().range([innerHeight, 0]);
  const group = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  const defs = svg.append("defs");
  defs.append("filter")
    .attr("id", "selectedBarGlow")
    .append("feDropShadow")
    .attr("dx", 0)
    .attr("dy", 0)
    .attr("stdDeviation", 11)
    .attr("flood-color", "#123f31")
    .attr("flood-opacity", 0.68);

  group.append("line").attr("x1", 0).attr("x2", innerWidth).attr("y1", innerHeight).attr("y2", innerHeight).attr("stroke", "#9eb7aa");
  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickSize(0).tickPadding(16));
  group.selectAll(".axis path").remove();

  group.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", d => x(d.branch))
    .attr("y", d => allZero ? innerHeight : y(d.value))
    .attr("width", x.bandwidth())
    .attr("height", d => allZero ? 0 : innerHeight - y(d.value))
    .attr("rx", 10)
    .attr("fill", d => colors.get(d.branch))
    .attr("filter", d => d.branch === state.selectedBranch ? "url(#selectedBarGlow)" : null)
    .on("click", (event, d) => {
      state.selectedBranch = d.branch;
      render();
    })
    .on("mousemove", (event, d) => showTooltip(event, `${d.branch}<br>${selectedMetricLabel()}: ${formatMinutes(d.value)}<br>Samples: ${d.sampleSize.toLocaleString()}`))
    .on("mouseleave", hideTooltip);

  group.selectAll(".bar-label")
    .data(data)
    .join("text")
    .attr("class", "bar-label")
    .attr("x", d => x(d.branch) + x.bandwidth() / 2)
    .attr("y", d => allZero ? innerHeight - 10 : y(d.value) - 12)
    .attr("text-anchor", "middle")
    .attr("font-size", d => formatMinutes(d.value).length > 8 ? 17 : 21)
    .text(d => formatMinutes(d.value));
}

function renderTimeScatter() {
  const data = state.timeOfDay.filter(point => point.mean_headway !== null);
  renderScatter({
    selector: "#time-scatter",
    data,
    xValue: d => d.hour,
    yValue: d => d.mean_headway,
    xDomain: [0, 23],
    xLabel: "Hour of Day",
    yLabel: "Mean Headway Minutes",
    xTicks: 8,
    yFormat: d => `${Number(d / 60).toFixed(0)}`,
    tooltipText: d => `${d.branch}<br>${formatHour(d.hour)}<br>Mean Headway: ${formatMinutes(d.mean_headway)}<br>Samples: ${d.sample_size.toLocaleString()}`
  });
}

function renderAttendanceScatter() {
  const data = state.attendance.filter(point => point.mean_headway !== null && point.entries !== null);
  const minEntries = d3.min(data, d => d.entries) ?? 0;
  const maxEntries = d3.max(data, d => d.entries) ?? 1;
  const padding = Math.max((maxEntries - minEntries) * 0.08, 250);
  renderScatter({
    selector: "#attendance-scatter",
    data,
    xValue: d => d.entries,
    yValue: d => d.mean_headway,
    xDomain: [Math.max(0, minEntries - padding), maxEntries + padding],
    xLabel: "Green Line Attendance",
    yLabel: "Mean Headway Minutes",
    xTicks: 6,
    yFormat: d => `${Number(d / 60).toFixed(0)}`,
    xFormat: d => d3.format(".2s")(d),
    tooltipText: d => `${d.branch}<br>${d.date}<br>Attendance: ${Number(d.entries).toLocaleString()}<br>Mean Headway: ${formatMinutes(d.mean_headway)}`
  });
}

function renderScatter(config) {
  const svg = d3.select(config.selector);
  const node = svg.node();
  const width = node.clientWidth || 460;
  const height = node.clientHeight || 272;
  const margin = { top: 18, right: 22, bottom: 48, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();

  if (!config.data.length) {
    svg.append("text").attr("class", "empty").attr("x", width / 2).attr("y", height / 2).text("No data for selected conditions");
    return;
  }

  const x = d3.scaleLinear().domain(config.xDomain).nice().range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, d3.max(config.data, config.yValue) * 1.12]).nice().range([innerHeight, 0]);
  const group = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  group.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));
  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(config.xTicks).tickFormat(config.xFormat || (d => d)));
  group.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(config.yFormat));
  group.append("text").attr("x", innerWidth / 2).attr("y", innerHeight + 40).attr("fill", "#557366").attr("text-anchor", "middle").attr("font-size", 12).attr("font-weight", 650).text(config.xLabel);
  group.append("text").attr("x", -innerHeight / 2).attr("y", -43).attr("transform", "rotate(-90)").attr("fill", "#557366").attr("text-anchor", "middle").attr("font-size", 12).attr("font-weight", 650).text(config.yLabel);

  group.selectAll("circle")
    .data(config.data)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", d => x(config.xValue(d)))
    .attr("cy", d => y(config.yValue(d)))
    .attr("r", d => d.branch === state.selectedBranch ? 6 : 4.5)
    .attr("fill", d => colors.get(d.branch))
    .attr("stroke", "none")
    .on("click", (event, d) => {
      state.selectedBranch = d.branch;
      render();
    })
    .on("mousemove", (event, d) => showTooltip(event, config.tooltipText(d)))
    .on("mouseleave", hideTooltip);
}

function renderDetails() {
  const branch = state.branches.find(item => item.branch === state.selectedBranch) ?? bestBranch();
  labels.detailTitle.textContent = "Selected Branch Details";
  document.querySelectorAll(".detail-stat").forEach(button => {
    button.classList.toggle("active", button.dataset.stationMetric === state.selectedStationMetric);
  });
  if (!branch) {
    labels.selectedBranchPill.textContent = "Selected Branch";
    labels.selectedBranchPill.style.background = "#197a35";
    [labels.detailMean, labels.detailMedian, labels.detailStd, labels.detailMin, labels.detailMax].forEach(label => {
      label.textContent = "0.0 min";
    });
    labels.stationTitle.textContent = `${stationMetricMeta[state.selectedStationMetric]?.label ?? "Mean"} Headway by Station`;
    return;
  }
  labels.detailMean.textContent = formatMinutes(branch.metrics.mean_headway);
  labels.detailMedian.textContent = formatMinutes(branch.metrics.median_headway);
  labels.detailStd.textContent = formatMinutes(branch.metrics.std_headway);
  labels.detailMin.textContent = formatMinutes(branch.metrics.min_headway);
  labels.detailMax.textContent = formatMinutes(branch.metrics.max_headway);
  labels.stationTitle.textContent = `${stationMetricMeta[state.selectedStationMetric]?.label ?? "Mean"} Headway by Station on ${branch.branch}`;
  labels.selectedBranchPill.textContent = `Selected Branch: ${branch.branch}`;
  labels.selectedBranchPill.style.background = colors.get(branch.branch) || "#197a35";
}

function renderStationChart() {
  const svg = d3.select("#station-chart");
  const node = svg.node();
  const metricKey = state.selectedStationMetric;
  const metricLabel = stationMetricMeta[metricKey]?.label ?? "Mean";
  const data = (state.stations[state.selectedBranch] || []).map(item => ({
    ...item,
    station_metric_seconds: Number(item[metricKey]),
    station_metric_minutes: Number(item[metricKey]) / 60
  })).filter(item => Number.isFinite(item.station_metric_seconds));
  const width = Math.max((data.length || 8) * 88, (node.parentElement?.clientWidth || 640) - 28);
  const height = node.clientHeight || 272;
  const margin = { top: 8, right: 20, bottom: 90, left: 108 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  svg.style("width", `${width}px`);
  if (!data.length) {
    svg.append("text").attr("class", "empty").attr("x", width / 2).attr("y", height / 2).text("No station data");
    return;
  }

  const x = d3.scaleBand().domain(data.map(d => d.station)).range([0, innerWidth]).padding(0.46);
  const y = d3.scaleLinear().domain([0, (d3.max(data, d => d.station_metric_minutes) ?? 0) * 1.12 || 1]).nice().range([innerHeight, 0]);
  const group = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickSize(0).tickPadding(8))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");
  group.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4).tickFormat(d => `${Number(d).toFixed(1)}m`));

  group.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", d => x(d.station))
    .attr("y", d => y(d.station_metric_minutes))
    .attr("width", x.bandwidth())
    .attr("height", d => innerHeight - y(d.station_metric_minutes))
    .attr("rx", 6)
    .attr("fill", colors.get(state.selectedBranch) || "#197a35")
    .on("mousemove", (event, d) => showTooltip(event, `${d.station}<br>${metricLabel} Headway: ${formatMinutes(d.station_metric_seconds)}<br>Samples: ${d.sample_size.toLocaleString()}`))
    .on("mouseleave", hideTooltip);
}

function formatMinutes(value) {
  if (value === null || Number.isNaN(Number(value))) {
    return "0.0 min";
  }
  return `${(Number(value) / 60).toFixed(1)} min`;
}

function formatHour(hour) {
  const value = Number(hour);
  if (value === 0) {
    return "12 AM";
  }
  if (value === 12) {
    return "12 PM";
  }
  return value > 12 ? `${value - 12} PM` : `${value} AM`;
}

function titleCase(value) {
  return value.toLowerCase().split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function showTooltip(event, html) {
  tooltip.html(html).style("left", `${event.clientX}px`).style("top", `${event.clientY}px`).style("opacity", 1);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

initialize();
