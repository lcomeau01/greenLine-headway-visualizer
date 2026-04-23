const state = {
  metrics: [],
  selectedMetric: "mean_headway",
  selectedBranch: null,
  branches: [],
  scatter: [],
  timeOfDay: [],
  stressIndex: 0,
  resizeTimer: null,
  timePeriod: "peak",
  dayType: "all"
};

const colors = new Map([
  ["Green-B", "#0b5d2a"],
  ["Green-C", "#2f8f3f"],
  ["Green-D", "#73bf44"],
  ["Green-E", "#a6d84f"]
]);

const controls = {
  weather: document.querySelector("#weather"),
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
  stress: document.querySelector("#stress-label"),
  chartTitle: document.querySelector("#chart-title"),
  selectedBranch: document.querySelector("#selected-branch-pill"),
  detailTitle: document.querySelector("#detail-title"),
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
  controls.minTemperature.value = controls.minTemperature.min;
  controls.maxTemperature.value = controls.maxTemperature.max;
  controls.minPrecipitation.max = Math.max(0.1, data.ranges.max_precipitation ?? 3);
  controls.maxPrecipitation.max = controls.minPrecipitation.max;
  controls.maxPrecipitation.value = controls.maxPrecipitation.max;
  controls.minSnow.max = Math.max(0.1, data.ranges.max_snow ?? 12);
  controls.maxSnow.max = controls.minSnow.max;
  controls.maxSnow.value = controls.maxSnow.max;
  controls.minAlertSeverity.max = Math.max(10, data.ranges.max_alert_severity ?? 10);
  controls.maxAlertSeverity.max = controls.minAlertSeverity.max;
  controls.maxAlertSeverity.value = controls.maxAlertSeverity.max;
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
  [
    [controls.minTemperature, controls.maxTemperature],
    [controls.minPrecipitation, controls.maxPrecipitation],
    [controls.minSnow, controls.maxSnow],
    [controls.minAlertSeverity, controls.maxAlertSeverity]
  ].forEach(pair => {
    pair.forEach(control => control.addEventListener("input", () => {
      normalizePair(pair[0], pair[1], control);
      updateLabels();
    }));
  });
  controls.weather.addEventListener("change", updateWeatherControls);
  controls.alertFilter.addEventListener("change", updateLabels);
  controls.reset.addEventListener("click", () => {
    resetFilters(true);
  });
  controls.apply.addEventListener("click", updateFromFilters);
  window.addEventListener("resize", () => {
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(render, 120);
  });
  updateLabels();
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
  updateWeatherControls();
  const severityActive = controls.alertFilter.value === "severity";
  controls.minAlertSeverity.disabled = !severityActive;
  controls.maxAlertSeverity.disabled = !severityActive;
  labels.alert.textContent = controls.alertFilter.value === "no_alert" ? "None" : `${controls.minAlertSeverity.value} to ${controls.maxAlertSeverity.value}`;
  labels.temperatureMin.textContent = controls.minTemperature.value === controls.minTemperature.min ? "Any" : `${controls.minTemperature.value}°F`;
  labels.temperatureMax.textContent = controls.maxTemperature.value === controls.maxTemperature.max ? "Any" : `${controls.maxTemperature.value}°F`;
  labels.precipitationMin.textContent = `${Number(controls.minPrecipitation.value).toFixed(2)} in`;
  labels.precipitationMax.textContent = `${Number(controls.maxPrecipitation.value).toFixed(2)} in`;
  labels.snowMin.textContent = `${Number(controls.minSnow.value).toFixed(1)} in`;
  labels.snowMax.textContent = `${Number(controls.maxSnow.value).toFixed(1)} in`;
}

function updateWeatherControls() {
  const weather = controls.weather.value;
  const precipitationActive = weather === "rain" || weather === "all";
  const snowActive = weather === "snow" || weather === "all";
  [controls.minPrecipitation, controls.maxPrecipitation].forEach(control => {
    control.disabled = !precipitationActive;
  });
  [controls.minSnow, controls.maxSnow].forEach(control => {
    control.disabled = !snowActive;
  });
  labels.precipitationMin.parentElement.parentElement.classList.toggle("disabled", !precipitationActive);
  labels.snowMin.parentElement.parentElement.classList.toggle("disabled", !snowActive);
}

function resetFilters(shouldFetch) {
  controls.weather.value = "clear";
  controls.demandLevel.value = "medium";
  controls.alertFilter.value = "no_alert";
  controls.minAlertSeverity.value = controls.minAlertSeverity.min;
  controls.maxAlertSeverity.value = controls.maxAlertSeverity.max;
  controls.minTemperature.value = controls.minTemperature.min;
  controls.maxTemperature.value = controls.maxTemperature.max;
  controls.minPrecipitation.value = controls.minPrecipitation.min;
  controls.maxPrecipitation.value = controls.maxPrecipitation.max;
  controls.minSnow.value = controls.minSnow.min;
  controls.maxSnow.value = controls.maxSnow.max;
  state.timePeriod = "peak";
  state.dayType = "all";
  document.querySelectorAll("#time-buttons button").forEach(button => button.classList.toggle("active", button.dataset.value === state.timePeriod));
  document.querySelectorAll("#day-buttons button").forEach(button => button.classList.toggle("active", button.dataset.value === state.dayType));
  updateLabels();
  if (shouldFetch) {
    updateFromFilters();
  }
}

function params() {
  const search = new URLSearchParams();
  search.set("weather", controls.weather.value);
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
  state.scatter = data.scatter;
  state.timeOfDay = data.time_of_day;
  state.stressIndex = Number(data.stress_index);
  state.selectedBranch = bestBranch()?.branch ?? null;
  labels.sample.textContent = `${Number(data.sample_size).toLocaleString()} samples`;
  controls.apply.disabled = false;
  controls.apply.textContent = "Apply Filters";
  render();
}

function render() {
  updateMetricTabs();
  renderBarChart();
  renderStressScatter();
  renderTimeScatter();
  renderGauge();
  renderDetails();
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
  const margin = { top: 22, right: 24, bottom: 58, left: 26 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const data = state.branches.map(branch => ({
    branch: branch.branch,
    value: branch.metrics[state.selectedMetric],
    sampleSize: branch.metrics.sample_size
  })).filter(item => item.value !== null);
  const maxBranch = bestBranch()?.branch;

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  labels.chartTitle.textContent = `${selectedMetricLabel()} Headway by Branch`;

  if (!data.length) {
    svg.append("text").attr("class", "empty").attr("x", width / 2).attr("y", height / 2).text("No data for selected conditions");
    return;
  }

  const x = d3.scaleBand().domain(data.map(d => d.branch)).range([0, innerWidth]).padding(0.36);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.value) * 1.28]).nice().range([innerHeight, 0]);
  const group = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  group.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""));
  group.append("line").attr("x1", 0).attr("x2", innerWidth).attr("y1", innerHeight).attr("y2", innerHeight).attr("stroke", "#9eb7aa");
  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).tickSize(0).tickPadding(16));
  group.selectAll(".axis path").remove();

  group.selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", d => x(d.branch))
    .attr("y", d => y(d.value))
    .attr("width", x.bandwidth())
    .attr("height", d => innerHeight - y(d.value))
    .attr("rx", 0)
    .attr("fill", d => d.branch === maxBranch ? "#ee2c31" : colors.get(d.branch))
    .attr("stroke", d => d.branch === state.selectedBranch ? "#123f31" : "none")
    .attr("stroke-width", d => d.branch === state.selectedBranch ? 4 : 0)
    .on("click", (event, d) => {
      state.selectedBranch = d.branch;
      renderDetails();
      renderStressScatter();
      renderTimeScatter();
    })
    .on("mousemove", (event, d) => showTooltip(event, `${d.branch}<br>${selectedMetricLabel()}: ${formatMinutes(d.value)}<br>Samples: ${d.sampleSize.toLocaleString()}`))
    .on("mouseleave", hideTooltip);

  group.selectAll(".bar-label")
    .data(data)
    .join("text")
    .attr("class", d => `bar-label ${d.branch === maxBranch ? "hot" : ""}`)
    .attr("x", d => x(d.branch) + x.bandwidth() / 2 - 7)
    .attr("y", d => y(d.value) - 10)
    .attr("text-anchor", "middle")
    .attr("font-size", 24)
    .text(d => minutesValue(d.value));

  group.selectAll(".bar-unit")
    .data(data)
    .join("text")
    .attr("class", "bar-unit")
    .attr("x", d => x(d.branch) + x.bandwidth() / 2 + 27)
    .attr("y", d => y(d.value) - 10)
    .attr("font-size", 13)
    .text("min");

  group.selectAll(".selected-marker")
    .data(data.filter(d => d.branch === state.selectedBranch))
    .join("path")
    .attr("class", "selected-marker")
    .attr("d", d => `M ${x(d.branch) + x.bandwidth() / 2 - 8} ${innerHeight + 35} L ${x(d.branch) + x.bandwidth() / 2 + 8} ${innerHeight + 35} L ${x(d.branch) + x.bandwidth() / 2} ${innerHeight + 23} Z`)
    .attr("fill", "#123f31");
}

function renderGauge() {
  const svg = d3.select("#stress-gauge");
  const node = svg.node();
  const width = node.clientWidth || 360;
  const height = node.clientHeight || 145;
  const cx = width / 2;
  const cy = height - 12;
  const radius = Math.min(width * 0.42, 132);
  const value = Math.max(0, Math.min(5, state.stressIndex));
  const angle = -90 + value * 36;
  const needleLength = radius * 0.72;
  const needleX = cx + Math.cos((angle - 90) * Math.PI / 180) * needleLength;
  const needleY = cy + Math.sin((angle - 90) * Math.PI / 180) * needleLength;
  const arc = d3.arc().innerRadius(radius * 0.62).outerRadius(radius).startAngle(d => d.start).endAngle(d => d.end);
  const slices = [
    { start: -Math.PI / 2, end: -Math.PI / 5, fill: "#0b5d2a" },
    { start: -Math.PI / 5, end: 0, fill: "#73bf44" },
    { start: 0, end: Math.PI / 5, fill: "#f7c62f" },
    { start: Math.PI / 5, end: Math.PI / 2, fill: "#ee2c31" }
  ];

  svg.attr("viewBox", `0 0 ${width} ${height}`).selectAll("*").remove();
  svg.append("g").attr("transform", `translate(${cx},${cy})`).selectAll("path").data(slices).join("path").attr("d", arc).attr("fill", d => d.fill);
  svg.append("path").attr("d", `M ${cx - radius * 0.52} ${cy - 4} Q ${cx} ${cy - 20} ${cx + radius * 0.52} ${cy - 4}`).attr("fill", "none").attr("stroke", "#0f5f2b").attr("stroke-width", 5);
  svg.append("line").attr("x1", cx).attr("y1", cy - 2).attr("x2", needleX).attr("y2", needleY).attr("stroke", "#123f31").attr("stroke-width", 6).attr("stroke-linecap", "round");
  svg.append("circle").attr("cx", cx).attr("cy", cy - 2).attr("r", 7).attr("fill", "#123f31");
  svg.append("text").attr("x", cx).attr("y", cy - 30).attr("text-anchor", "middle").attr("font-size", 44).attr("font-weight", 840).attr("fill", "#123f31").text(value.toFixed(1));
  labels.stress.textContent = value >= 4 ? "Severe Stress" : value >= 2.5 ? "Medium-High Stress" : value >= 1.25 ? "Medium Stress" : "No Stress";
}

function renderStressScatter() {
  const data = state.scatter
    .map(point => ({ ...point, headway: point.metrics.mean_headway }))
    .filter(point => point.headway !== null);
  renderScatter({
    selector: "#stress-scatter",
    data,
    xValue: d => d.stress_index,
    yValue: d => d.headway,
    xDomain: [0, 5],
    xLabel: "Stress Index",
    yLabel: "Mean Headway Minutes",
    xTicks: 6,
    yFormat: d => `${Number(d / 60).toFixed(0)}`,
    tooltipText: d => `${d.branch}<br>${d.date}<br>Stress: ${d.stress_index}<br>Mean Headway: ${formatMinutes(d.headway)}`
  });
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
  group.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(config.xTicks));
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
    .attr("stroke", d => d.branch === state.selectedBranch ? "#123f31" : "#ffffff")
    .on("click", (event, d) => {
      state.selectedBranch = d.branch;
      renderBarChart();
      renderDetails();
      renderStressScatter();
      renderTimeScatter();
    })
    .on("mousemove", (event, d) => showTooltip(event, config.tooltipText(d)))
    .on("mouseleave", hideTooltip);
}

function renderDetails() {
  const branch = state.branches.find(item => item.branch === state.selectedBranch) ?? bestBranch();
  if (!branch) {
    labels.detailTitle.textContent = "Branch Details";
    [labels.detailMean, labels.detailMedian, labels.detailStd, labels.detailMin, labels.detailMax].forEach(label => {
      label.textContent = "0.0 min";
    });
    return;
  }
  labels.detailTitle.textContent = `${branch.branch} Branch Details`;
  labels.selectedBranch.textContent = `Selected: ${branch.branch}`;
  labels.selectedBranch.style.background = colors.get(branch.branch);
  labels.detailMean.textContent = formatMinutes(branch.metrics.mean_headway);
  labels.detailMedian.textContent = formatMinutes(branch.metrics.median_headway);
  labels.detailStd.textContent = formatMinutes(branch.metrics.std_headway);
  labels.detailMin.textContent = formatMinutes(branch.metrics.min_headway);
  labels.detailMax.textContent = formatMinutes(branch.metrics.max_headway);
}

function minutesValue(value) {
  return (Number(value) / 60).toFixed(1);
}

function formatMinutes(value) {
  if (value === null || Number.isNaN(Number(value))) {
    return "0.0 min";
  }
  return `${minutesValue(value)} min`;
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
