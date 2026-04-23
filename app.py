from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

try:
    from flask_cors import CORS
except ImportError:
    CORS = None


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BRANCHES = ["Green-B", "Green-C", "Green-D", "Green-E"]
METRICS = [
    {"key": "mean_headway", "label": "Mean"},
    {"key": "median_headway", "label": "Median"},
    {"key": "std_headway", "label": "Std Dev"},
    {"key": "min_headway", "label": "Min"},
    {"key": "max_headway", "label": "Max"},
]

app = Flask(__name__)
if CORS:
    CORS(app)
db = duckdb.connect(database=":memory:")
ready = False


def load_database():
    global ready
    if ready:
        return

    headway_glob = str(DATA_DIR / "Headway Data" / "*_Headway.csv")
    alert_glob = str(DATA_DIR / "Alert Data" / "*_ALERTS.csv")
    weather_path = str(DATA_DIR / "weather_data.csv")
    entry_path = str(DATA_DIR / "EntryData.csv")

    db.execute(
        """
        create table headways as
        select
            try_cast(service_date as date) as service_date,
            route_id,
            stop_name,
            try_cast(stop_departure_datetime as timestamp) as departure_time,
            try_cast(stop_departure_sec as integer) as departure_second,
            try_cast(headway_trunk_seconds as double) as headway_trunk_seconds,
            try_cast(headway_branch_seconds as double) as headway_branch_seconds
        from read_csv_auto(?, all_varchar = true, union_by_name = true)
        where route_id in ('Green-B', 'Green-C', 'Green-D', 'Green-E')
          and try_cast(headway_branch_seconds as double) is not null
        """,
        [headway_glob],
    )
    db.execute(
        """
        create table weather as
        select
            try_cast(DATE as date) as service_date,
            coalesce(try_cast(PRCP as double), 0) as precipitation,
            coalesce(try_cast(SNOW as double), 0) as snow,
            coalesce(try_cast(TAVG as double), (try_cast(TMAX as double) + try_cast(TMIN as double)) / 2) as temperature
        from read_csv_auto(?, all_varchar = true)
        """,
        [weather_path],
    )
    db.execute(
        """
        create table demand_raw as
        select
            try_cast(service_date as date) as service_date,
            try_cast(regexp_extract(time_period, '([0-9]{2}):([0-9]{2}):([0-9]{2})', 1) as integer) as hour,
            try_cast(gated_entries as double) as entries
        from read_csv_auto(?, all_varchar = true)
        where route_or_line = 'Green Line'
        """,
        [entry_path],
    )
    db.execute(
        """
        create table demand as
        select
            service_date,
            sum(entries) as entries,
            case
                when sum(entries) <= quantile_cont(sum(entries), 0.333333) over () then 'low'
                when sum(entries) >= quantile_cont(sum(entries), 0.666667) over () then 'high'
                else 'medium'
            end as demand_level
        from demand_raw
        group by service_date
        """,
    )
    db.execute(
        """
        create table alerts as
        select
            try_cast(active_period_start_date as date) as service_date,
            route_id,
            max(try_cast(severity as integer)) as max_severity,
            count(distinct alert_id) as alert_count,
            string_agg(distinct effect_detail, '|') as alert_types
        from read_csv_auto(?, all_varchar = true, union_by_name = true)
        where route_id in ('Green-B', 'Green-C', 'Green-D', 'Green-E')
          and active_period_start_date is not null
          and try_cast(severity as integer) is not null
        group by service_date, route_id
        """,
        [alert_glob],
    )
    for table in ["headways", "weather", "demand", "alerts"]:
        db.execute(f"analyze {table}")
    ready = True


def filters():
    return {
        "weather": request.args.get("weather", "clear"),
        "alert_filter": request.args.get("alert_filter", "no_alert"),
        "min_alert_severity": number_arg("min_alert_severity", 0),
        "max_alert_severity": number_arg("max_alert_severity", 10),
        "demand_level": request.args.get("demand_level", "medium"),
        "time_period": request.args.get("time_period", "peak"),
        "day_type": request.args.get("day_type", "all"),
        "min_temperature": number_arg("min_temperature"),
        "max_temperature": number_arg("max_temperature"),
        "min_precipitation": number_arg("min_precipitation"),
        "max_precipitation": number_arg("max_precipitation"),
        "min_snow": number_arg("min_snow"),
        "max_snow": number_arg("max_snow"),
    }


def number_arg(name, default=None):
    value = request.args.get(name)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except ValueError:
        return default


def filtered_rows(params):
    clauses = []
    values = []

    if params["weather"] == "rain":
        clauses.append("coalesce(w.precipitation, 0) > 0")
    if params["weather"] == "snow":
        clauses.append("coalesce(w.snow, 0) > 0")
    if params["weather"] == "clear":
        clauses.append("coalesce(w.precipitation, 0) = 0 and coalesce(w.snow, 0) = 0")
    if params["demand_level"] in {"low", "medium", "high"}:
        clauses.append("d.demand_level = ?")
        values.append(params["demand_level"])
    if params["time_period"] == "peak":
        clauses.append("((h.departure_second between 25200 and 36000) or (h.departure_second between 57600 and 68400))")
    if params["time_period"] == "offpeak":
        clauses.append("not ((h.departure_second between 25200 and 36000) or (h.departure_second between 57600 and 68400))")
    if params["day_type"] == "weekday":
        clauses.append("dayofweek(h.service_date) between 1 and 5")
    if params["day_type"] == "weekend":
        clauses.append("dayofweek(h.service_date) in (0, 6)")
    if params["alert_filter"] == "no_alert":
        clauses.append("coalesce(a.alert_count, 0) = 0")
    elif params["alert_filter"] == "severity":
        clauses.append("coalesce(a.alert_count, 0) > 0")
        if params["min_alert_severity"] is not None:
            clauses.append("coalesce(a.max_severity, 0) >= ?")
            values.append(params["min_alert_severity"])
        if params["max_alert_severity"] is not None:
            clauses.append("coalesce(a.max_severity, 0) <= ?")
            values.append(params["max_alert_severity"])
    elif params["alert_filter"]:
        clauses.append("strpos(coalesce(a.alert_types, ''), ?) > 0")
        values.append(params["alert_filter"])
    if params["min_temperature"] is not None:
        clauses.append("w.temperature >= ?")
        values.append(params["min_temperature"])
    if params["max_temperature"] is not None:
        clauses.append("w.temperature <= ?")
        values.append(params["max_temperature"])
    if params["weather"] in {"rain", "all"} and params["min_precipitation"] is not None:
        clauses.append("w.precipitation >= ?")
        values.append(params["min_precipitation"])
    if params["weather"] in {"rain", "all"} and params["max_precipitation"] is not None:
        clauses.append("w.precipitation <= ?")
        values.append(params["max_precipitation"])
    if params["weather"] in {"snow", "all"} and params["min_snow"] is not None:
        clauses.append("w.snow >= ?")
        values.append(params["min_snow"])
    if params["weather"] in {"snow", "all"} and params["max_snow"] is not None:
        clauses.append("w.snow <= ?")
        values.append(params["max_snow"])

    where_sql = " and ".join(clauses)
    if where_sql:
        where_sql = "where " + where_sql

    query = f"""
        select
            h.service_date,
            h.route_id as branch,
            h.stop_name,
            h.departure_time,
            h.departure_second,
            h.headway_branch_seconds,
            coalesce(w.precipitation, 0) as precipitation,
            coalesce(w.snow, 0) as snow,
            w.temperature,
            coalesce(d.entries, 0) as entries,
            coalesce(d.demand_level, 'unknown') as demand_level,
            coalesce(a.max_severity, 0) as alert_severity,
            coalesce(a.alert_count, 0) as alert_count,
            coalesce(a.alert_types, '') as alert_types
        from headways h
        left join weather w on h.service_date = w.service_date
        left join demand d on h.service_date = d.service_date
        left join alerts a on h.service_date = a.service_date and h.route_id = a.route_id
        {where_sql}
    """
    return db.execute(query, values).df()


def metric_bundle(frame):
    grouped = frame.groupby("branch")["headway_branch_seconds"]
    stats = grouped.agg(["mean", "median", "std", "min", "max", "count"]).reset_index()
    branches = []
    for branch in BRANCHES:
        row = stats[stats["branch"] == branch]
        if row.empty:
            metrics = {
                "mean_headway": None,
                "median_headway": None,
                "std_headway": None,
                "min_headway": None,
                "max_headway": None,
                "sample_size": 0,
            }
        else:
            item = row.iloc[0]
            metrics = {
                "mean_headway": finite(item["mean"]),
                "median_headway": finite(item["median"]),
                "std_headway": finite(item["std"]),
                "min_headway": finite(item["min"]),
                "max_headway": finite(item["max"]),
                "sample_size": int(item["count"]),
            }
        branches.append({"branch": branch, "metrics": metrics})
    return branches


def finite(value):
    if value is None or pd.isna(value) or not np.isfinite(value):
        return None
    return round(float(value), 2)


def stress_index(frame, params):
    alert_score = alert_stress(params)
    weather_score = weather_stress(params)
    demand_score = {"medium": 0, "all": 0.08, "low": 0.08, "high": 0.42}.get(params["demand_level"], 0)
    time_score = {"peak": 0.28, "offpeak": 0.04, "all": 0}.get(params["time_period"], 0)
    day_score = {"weekday": 0.14, "weekend": 0.05, "all": 0}.get(params["day_type"], 0)
    interaction = 0
    if params["weather"] == "rain" and params["time_period"] == "peak":
        interaction += 0.32
    if params["weather"] == "snow" and params["day_type"] == "weekday":
        interaction += 0.18
    if params["demand_level"] == "high" and params["time_period"] == "peak":
        interaction += 0.16
    if alert_score >= 0.6 and params["weather"] in {"rain", "snow"}:
        interaction += 0.2
    condition_active = alert_score > 0 or weather_score > 0 or demand_score >= 0.4
    time_component = time_score if condition_active else 0
    day_component = day_score if condition_active else 0
    score = 5 * (0.5 * alert_score + 0.32 * weather_score + 0.14 * demand_score + 0.08 * time_component + 0.06 * day_component + interaction)
    if alert_score >= 0.8:
        score = max(score, 4.25)
    elif alert_score >= 0.65:
        score = max(score, 3.35)
    return round(min(score, 5), 2)


def alert_stress(params):
    if params["alert_filter"] == "severity":
        minimum = params["min_alert_severity"] or 0
        maximum = params["max_alert_severity"] or minimum
        severity = max(minimum, maximum * 0.7)
        return min(severity / 10, 1)
    elif params["alert_filter"] not in {"", "no_alert"}:
        serious = {"SUSPENSION", "SHUTTLE", "DELAY", "STATION_CLOSURE"}
        return 0.72 if params["alert_filter"] in serious else 0.5
    return 0


def weather_stress(params):
    temp = temperature_stress(params["min_temperature"], params["max_temperature"])
    if params["weather"] == "clear":
        return temp
    if params["weather"] == "rain":
        precipitation = range_score(params["min_precipitation"], 0.5, 1.5)
        return max(0.48, precipitation, temp)
    if params["weather"] == "snow":
        snow = range_score(params["min_snow"], 1, 4)
        return max(0.58, snow, temp)
    mixed = max(range_score(params["min_precipitation"], 0.5, 1.5), range_score(params["min_snow"], 1, 4), temp)
    return max(0.18, mixed)


def range_score(minimum, medium, high):
    if minimum is None or minimum <= 0:
        return 0
    if minimum >= high:
        return 1
    if minimum >= medium:
        return 0.65
    return 0.35


def temperature_stress(minimum, maximum):
    cold = 0 if maximum is None else max(0, min((45 - float(maximum)) / 30, 1))
    hot = 0 if minimum is None else max(0, min((float(minimum) - 75) / 15, 1))
    return max(cold, hot)


def scatter_points(frame, metric=None):
    if frame.empty:
        return []
    daily = (
        frame.groupby(["service_date", "branch"])
        .agg(
            mean_headway=("headway_branch_seconds", "mean"),
            median_headway=("headway_branch_seconds", "median"),
            std_headway=("headway_branch_seconds", "std"),
            min_headway=("headway_branch_seconds", "min"),
            max_headway=("headway_branch_seconds", "max"),
            precipitation=("precipitation", "mean"),
            snow=("snow", "mean"),
            entries=("entries", "mean"),
            alert_severity=("alert_severity", "max"),
        )
        .reset_index()
    )
    daily["stress"] = daily.apply(row_stress, axis=1)
    daily = daily.sort_values(["service_date", "branch"])
    return [
        {
            "date": row.service_date.isoformat(),
            "branch": row.branch,
            "stress_index": round(float(row.stress), 2),
            "metrics": {
                "mean_headway": finite(row.mean_headway),
                "median_headway": finite(row.median_headway),
                "std_headway": finite(row.std_headway),
                "min_headway": finite(row.min_headway),
                "max_headway": finite(row.max_headway),
            },
            "precipitation": finite(row.precipitation),
            "snow": finite(row.snow),
            "entries": finite(row.entries),
            "alert_severity": finite(row.alert_severity),
        }
        for row in daily.itertuples()
        if finite(row.mean_headway) is not None
    ]


def row_stress(row):
    severity = min(float(row.alert_severity) / 10, 1)
    weather = max(min(float(row.precipitation) / 1.5, 1), min(float(row.snow) / 6, 1))
    demand = min(float(row.entries) / 50000, 1)
    return min((0.45 * severity + 0.3 * weather + 0.25 * demand) * 5, 5)


def time_of_day_points(frame):
    if frame.empty:
        return []
    data = frame.copy()
    data["hour"] = (data["departure_second"] // 3600).clip(0, 23)
    hourly = (
        data.groupby(["hour", "branch"])
        .agg(mean_headway=("headway_branch_seconds", "mean"), sample_size=("headway_branch_seconds", "count"))
        .reset_index()
        .sort_values(["hour", "branch"])
    )
    return [
        {
            "hour": int(row.hour),
            "branch": row.branch,
            "mean_headway": finite(row.mean_headway),
            "sample_size": int(row.sample_size),
        }
        for row in hourly.itertuples()
        if finite(row.mean_headway) is not None
    ]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/init")
def initialize():
    load_database()
    ranges = db.execute(
        """
        select
            min(h.service_date) as min_date,
            max(h.service_date) as max_date,
            min(w.temperature) as min_temperature,
            max(w.temperature) as max_temperature,
            max(w.precipitation) as max_precipitation,
            max(w.snow) as max_snow,
            max(a.max_severity) as max_alert_severity,
            max(d.entries) as max_entries
        from headways h
        left join weather w on h.service_date = w.service_date
        left join demand d on h.service_date = d.service_date
        left join alerts a on h.service_date = a.service_date and h.route_id = a.route_id
        """
    ).fetchone()
    return jsonify(
        {
            "branches": BRANCHES,
            "metrics": METRICS,
            "ranges": {
                "min_date": ranges[0].isoformat(),
                "max_date": ranges[1].isoformat(),
                "min_temperature": finite(ranges[2]),
                "max_temperature": finite(ranges[3]),
                "max_precipitation": finite(ranges[4]),
                "max_snow": finite(ranges[5]),
                "max_alert_severity": finite(ranges[6]),
                "max_entries": finite(ranges[7]),
            },
            "alert_types": db.execute(
                """
                select effect_detail
                from (
                    select unnest(string_split(alert_types, '|')) as effect_detail
                    from alerts
                )
                where effect_detail is not null and effect_detail != ''
                group by effect_detail
                order by effect_detail
                """
            ).fetchdf()["effect_detail"].tolist(),
        }
    )


@app.route("/api/bar")
def bar_data():
    load_database()
    params = filters()
    frame = filtered_rows(params)
    return jsonify(
        {
            "conditions": params,
            "branches": metric_bundle(frame),
            "stress_index": stress_index(frame, params),
            "sample_size": int(len(frame)),
        }
    )


@app.route("/api/scatter")
def scatter_data():
    load_database()
    params = filters()
    metric = request.args.get("metric", "mean_headway")
    frame = filtered_rows(params)
    return jsonify(
        {
            "conditions": params,
            "metric": metric,
            "points": scatter_points(frame, metric),
            "sample_size": int(len(frame)),
        }
    )


@app.route("/api/analytics")
def analytics():
    load_database()
    params = filters()
    metric = request.args.get("metric", "mean_headway")
    frame = filtered_rows(params)
    return jsonify(
        {
            "conditions": params,
            "branches": metric_bundle(frame),
            "scatter": scatter_points(frame, metric),
            "time_of_day": time_of_day_points(frame),
            "stress_index": stress_index(frame, params),
            "sample_size": int(len(frame)),
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
