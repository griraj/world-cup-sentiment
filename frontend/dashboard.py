"""
World Cup Sentiment Tracker – Plotly Dash Dashboard

Dark-mode, real-time sports analytics dashboard.
All live updates driven by dcc.Interval callbacks.
"""

import logging
from datetime import datetime

import dash
from dash import dcc, html, Input, Output, callback
import plotly.graph_objects as go
import plotly.express as px
import pandas as pd

from backend.dashboard_data import (
    get_sentiment_timeline,
    get_volume_timeline,
    get_team_comparison,
    get_live_feed,
    get_summary_stats,
    get_recent_events,
    get_word_frequencies,
    get_momentum_score,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Color palette & theme
# ---------------------------------------------------------------------------
COLORS = {
    "bg":         "#0a0e1a",
    "surface":    "#111827",
    "surface2":   "#1c2433",
    "border":     "#2d3748",
    "accent":     "#00d4ff",
    "accent2":    "#ff6b35",
    "positive":   "#00e676",
    "negative":   "#ff4444",
    "neutral":    "#78909c",
    "text":       "#e2e8f0",
    "text_dim":   "#718096",
    "gold":       "#ffd700",
    "purple":     "#a855f7",
}

PLOT_LAYOUT = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font=dict(color=COLORS["text"], family="'Rajdhani', 'Oswald', sans-serif"),
    margin=dict(l=40, r=20, t=30, b=40),
    legend=dict(
        bgcolor="rgba(0,0,0,0.4)",
        bordercolor=COLORS["border"],
        borderwidth=1,
    ),
    xaxis=dict(
        gridcolor=COLORS["border"],
        zerolinecolor=COLORS["border"],
        tickfont=dict(color=COLORS["text_dim"]),
    ),
    yaxis=dict(
        gridcolor=COLORS["border"],
        zerolinecolor=COLORS["border"],
        tickfont=dict(color=COLORS["text_dim"]),
    ),
)

TEAMS = [
    "Argentina", "Brazil", "France", "England",
    "Germany", "Spain", "Portugal", "Morocco",
    "Japan", "USA",
]

TEAM_COLORS = {
    "Argentina": "#74acdf",
    "Brazil":    "#009c3b",
    "France":    "#002395",
    "England":   "#cf111b",
    "Germany":   "#e8e8e8",
    "Spain":     "#c60b1e",
    "Portugal":  "#006600",
    "Morocco":   "#c1272d",
    "Japan":     "#bc002d",
    "USA":       "#3c3b6e",
}

SENTIMENT_ICON = {
    "POSITIVE": "🟢",
    "NEGATIVE": "🔴",
    "NEUTRAL":  "🔵",
}

EVENT_ICON = {
    "GOAL":             "⚽",
    "RED_CARD_OR_VAR":  "🟥",
    "MATCH_SPIKE":      "📈",
    "POSITIVE_SHIFT":   "📣",
    "NEGATIVE_SHIFT":   "😠",
}

# ---------------------------------------------------------------------------
# Reusable component builders
# ---------------------------------------------------------------------------

def stat_card(title: str, value: str, subtitle: str = "", color: str = COLORS["accent"]) -> html.Div:
    return html.Div([
        html.P(title, className="stat-label"),
        html.H2(value, style={"color": color, "margin": "4px 0"}),
        html.P(subtitle, className="stat-sub"),
    ], className="stat-card")


def section_header(text: str, icon: str = "") -> html.Div:
    return html.Div([
        html.Span(icon + " " if icon else "", style={"marginRight": "6px"}),
        html.Span(text),
    ], className="section-header")


# ---------------------------------------------------------------------------
# Dash app factory
# ---------------------------------------------------------------------------

def create_app() -> dash.Dash:
    app = dash.Dash(
        __name__,
        title="⚽ World Cup Sentiment Tracker",
        meta_tags=[{"name": "viewport", "content": "width=device-width, initial-scale=1"}],
        suppress_callback_exceptions=True,
    )

    app.layout = html.Div([
        # Fonts
        html.Link(rel="stylesheet", href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&family=Roboto+Mono:wght@400;500&display=swap"),

        # Inline CSS
        html.Style("""
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: #0a0e1a;
            font-family: 'Rajdhani', sans-serif;
            color: #e2e8f0;
            min-height: 100vh;
        }
        .page-wrap { max-width: 1600px; margin: 0 auto; padding: 16px 20px; }

        /* ── Header ── */
        .header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 24px;
            background: linear-gradient(90deg, #0d1525 0%, #111827 100%);
            border-bottom: 2px solid #00d4ff30;
            margin-bottom: 20px;
            border-radius: 8px;
        }
        .header-title {
            font-family: 'Orbitron', sans-serif;
            font-size: 1.6rem; font-weight: 900;
            background: linear-gradient(90deg, #00d4ff, #a855f7);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            letter-spacing: 2px;
        }
        .header-right { display: flex; align-items: center; gap: 16px; }
        .live-badge {
            background: #ff444420; color: #ff4444;
            border: 1px solid #ff444440;
            padding: 4px 12px; border-radius: 20px;
            font-size: 0.75rem; font-weight: 600; letter-spacing: 2px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%,100% { opacity:1; } 50% { opacity:0.5; }
        }
        .clock { font-family:'Roboto Mono',monospace; color:#718096; font-size:0.85rem; }

        /* ── Stat cards ── */
        .stats-row { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-bottom:20px; }
        .stat-card {
            background: #111827; border: 1px solid #2d3748;
            border-radius: 10px; padding: 14px 16px;
            text-align: center; transition: border-color .2s;
        }
        .stat-card:hover { border-color: #00d4ff50; }
        .stat-label { font-size:.7rem; color:#718096; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:4px; }
        .stat-sub   { font-size:.7rem; color:#4a5568; margin-top:2px; }

        /* ── Charts grid ── */
        .charts-grid { display:grid; grid-template-columns:2fr 1fr; gap:16px; margin-bottom:16px; }
        .charts-bottom { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-bottom:16px; }
        .panel {
            background:#111827; border:1px solid #2d3748;
            border-radius:10px; padding:16px; overflow:hidden;
        }
        .section-header {
            font-size:.75rem; color:#00d4ff; letter-spacing:2px;
            text-transform:uppercase; font-weight:600;
            border-bottom:1px solid #2d3748; padding-bottom:8px; margin-bottom:12px;
        }

        /* ── Team selector ── */
        .team-pills { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
        .Select-control, .Select-menu-outer { background:#1c2433 !important; border-color:#2d3748 !important; color:#e2e8f0 !important; }

        /* ── Live feed ── */
        .feed-item {
            padding: 10px 12px;
            border-bottom: 1px solid #1c2433;
            display: flex; gap: 10px; align-items: flex-start;
            transition: background .15s;
        }
        .feed-item:hover { background:#1c2433; }
        .feed-badge {
            padding:2px 8px; border-radius:12px; font-size:.65rem;
            font-weight:700; letter-spacing:1px; white-space:nowrap;
            flex-shrink:0; margin-top:2px;
        }
        .feed-pos { background:#00e67620; color:#00e676; border:1px solid #00e67640; }
        .feed-neg { background:#ff444420; color:#ff4444; border:1px solid #ff444440; }
        .feed-neu { background:#78909c20; color:#90a4ae; border:1px solid #78909c40; }
        .feed-text { font-size:.85rem; color:#cbd5e0; line-height:1.4; }
        .feed-meta { font-size:.7rem; color:#4a5568; margin-top:3px; }
        .feed-viral { font-size:.65rem; color:#ffd700; margin-left:6px; }

        /* ── Events ── */
        .event-item { display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #1c2433; }
        .event-icon { font-size:1.2rem; flex-shrink:0; }
        .event-type { font-size:.75rem; font-weight:700; color:#00d4ff; letter-spacing:1px; }
        .event-desc { font-size:.75rem; color:#718096; margin-top:2px; }
        .event-time { font-size:.65rem; color:#4a5568; }

        /* ── Momentum ── */
        .momentum-wrap { display:flex; flex-direction:column; align-items:center; gap:8px; }

        /* ── Word cloud ── */
        #wordcloud-container { min-height:180px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; justify-content:center; padding:10px 4px; }

        /* ── Dropdown override ── */
        .team-dropdown .Select-control { background:#1c2433 !important; border:1px solid #2d3748 !important; }

        /* ── Responsive ── */
        @media (max-width:1100px) {
            .stats-row { grid-template-columns:repeat(3,1fr); }
            .charts-grid { grid-template-columns:1fr; }
            .charts-bottom { grid-template-columns:1fr; }
        }
        @media (max-width:600px) {
            .stats-row { grid-template-columns:repeat(2,1fr); }
            .header-title { font-size:1.1rem; }
        }
        """),

        # ── Refresh intervals ──
        dcc.Interval(id="interval-fast",  interval=3000,  n_intervals=0),  # 3s
        dcc.Interval(id="interval-medium",interval=8000,  n_intervals=0),  # 8s
        dcc.Interval(id="interval-slow",  interval=30000, n_intervals=0),  # 30s

        html.Div([
            # ── Header ──
            html.Div([
                html.Div("⚽ WORLD CUP SENTIMENT", className="header-title"),
                html.Div([
                    html.Div("● LIVE", className="live-badge"),
                    html.Div(id="clock", className="clock"),
                ], className="header-right"),
            ], className="header"),

            # ── Stat cards ──
            html.Div(id="stat-cards", className="stats-row"),

            # ── Main charts row ──
            html.Div([
                # Sentiment timeline
                html.Div([
                    section_header("Sentiment Timeline", "📊"),
                    dcc.Graph(id="sentiment-timeline", config={"displayModeBar": False}, style={"height": "280px"}),
                ], className="panel"),

                # Momentum + events
                html.Div([
                    section_header("Crowd Momentum", "⚡"),
                    html.Div(id="momentum-gauge", className="momentum-wrap"),
                    html.Div(style={"height":"16px"}),
                    section_header("Match Events", "🚨"),
                    html.Div(id="events-list", style={"maxHeight":"200px","overflowY":"auto"}),
                ], className="panel"),
            ], className="charts-grid"),

            # ── Bottom row ──
            html.Div([
                # Volume graph
                html.Div([
                    section_header("Tweet Volume / min", "📈"),
                    dcc.Graph(id="volume-graph", config={"displayModeBar": False}, style={"height": "200px"}),
                ], className="panel"),

                # Team comparison
                html.Div([
                    section_header("Team Sentiment", "🏟️"),
                    dcc.Dropdown(
                        id="team-selector",
                        options=[{"label": t, "value": t} for t in TEAMS],
                        value=["Argentina", "Brazil", "France"],
                        multi=True,
                        style={"background": "#1c2433", "color": "#e2e8f0", "marginBottom": "8px"},
                        className="team-dropdown",
                    ),
                    dcc.Graph(id="team-comparison", config={"displayModeBar": False}, style={"height": "160px"}),
                ], className="panel"),

                # Word cloud
                html.Div([
                    section_header("Trending Words", "💬"),
                    html.Div(id="wordcloud-container"),
                ], className="panel"),
            ], className="charts-bottom"),

            # ── Live feed ──
            html.Div([
                section_header("Live Tweet Feed", "🐦"),
                html.Div(id="live-feed"),
            ], className="panel"),

        ], className="page-wrap"),
    ])

    # ========================================================================
    # Callbacks
    # ========================================================================

    @app.callback(Output("clock", "children"), Input("interval-fast", "n_intervals"))
    def update_clock(n):
        return datetime.utcnow().strftime("UTC  %H:%M:%S")

    # ── Stat cards ──
    @app.callback(Output("stat-cards", "children"), Input("interval-fast", "n_intervals"))
    def update_stats(n):
        s = get_summary_stats(minutes=5)
        return [
            stat_card("Total Tweets",   f'{s["total_tweets"]:,}',           "all time",             COLORS["accent"]),
            stat_card("Per Minute",     f'{s["tweets_per_min"]}',            "last 5 min",           COLORS["purple"]),
            stat_card("Positive",       f'{s["positive_pct"]}%',             "last 5 min",           COLORS["positive"]),
            stat_card("Negative",       f'{s["negative_pct"]}%',             "last 5 min",           COLORS["negative"]),
            stat_card("Mood Score",     f'{s["sentiment_score"]:+.2f}',      "-1 negative / +1 pos", COLORS["gold"]),
            stat_card("Viral Tweets",   f'{s["viral_tweets"]:,}',            "200+ likes",           COLORS["accent2"]),
        ]

    # ── Sentiment timeline ──
    @app.callback(Output("sentiment-timeline", "figure"), Input("interval-fast", "n_intervals"))
    def update_sentiment_timeline(n):
        df = get_sentiment_timeline(minutes=30)
        fig = go.Figure()

        if not df.empty:
            # Filled area for positive
            fig.add_trace(go.Scatter(
                x=df["bucket_time"], y=df["positive_count"],
                name="Positive", mode="lines",
                line=dict(color=COLORS["positive"], width=2),
                fill="tozeroy", fillcolor="rgba(0,230,118,0.08)",
            ))
            # Filled area for negative
            fig.add_trace(go.Scatter(
                x=df["bucket_time"], y=df["negative_count"],
                name="Negative", mode="lines",
                line=dict(color=COLORS["negative"], width=2),
                fill="tozeroy", fillcolor="rgba(255,68,68,0.08)",
            ))
            # Sentiment score on secondary y
            fig.add_trace(go.Scatter(
                x=df["bucket_time"], y=df["sentiment_score"],
                name="Score", mode="lines",
                line=dict(color=COLORS["gold"], width=2, dash="dot"),
                yaxis="y2",
            ))

            # Annotate events
            events = get_recent_events(limit=5)
            for ev in events:
                et = ev.get("timestamp")
                if et:
                    try:
                        ts = datetime.fromisoformat(et)
                        icon = EVENT_ICON.get(ev["event_type"], "📌")
                        fig.add_vline(
                            x=ts.timestamp() * 1000,
                            line=dict(color=COLORS["accent"], dash="dot", width=1),
                            annotation_text=f"{icon}",
                            annotation_position="top",
                            annotation_font_color=COLORS["accent"],
                        )
                    except Exception:
                        pass

        fig.update_layout(
            **PLOT_LAYOUT,
            yaxis2=dict(
                overlaying="y", side="right",
                range=[-1, 1], showgrid=False,
                tickfont=dict(color=COLORS["gold"]),
                zeroline=True, zerolinecolor=COLORS["border"],
            ),
            legend=dict(orientation="h", y=1.08, x=0),
        )
        return fig

    # ── Volume graph ──
    @app.callback(Output("volume-graph", "figure"), Input("interval-fast", "n_intervals"))
    def update_volume(n):
        df = get_volume_timeline(minutes=30)
        fig = go.Figure()

        if not df.empty:
            fig.add_trace(go.Bar(
                x=df["bucket_time"], y=df["tweet_count"],
                marker_color=COLORS["accent"],
                marker_line_width=0,
                opacity=0.8,
                name="Tweets/min",
            ))
            # Spike threshold line
            mean_vol = df["tweet_count"].mean()
            spike_threshold = mean_vol * 3
            fig.add_hline(
                y=spike_threshold,
                line_dash="dot", line_color=COLORS["accent2"],
                annotation_text="Spike threshold",
                annotation_font_color=COLORS["accent2"],
                annotation_font_size=10,
            )

        fig.update_layout(**PLOT_LAYOUT)
        return fig

    # ── Team comparison ──
    @app.callback(
        Output("team-comparison", "figure"),
        [Input("interval-medium", "n_intervals"), Input("team-selector", "value")]
    )
    def update_team_comparison(n, selected_teams):
        if not selected_teams:
            return go.Figure(layout=PLOT_LAYOUT)

        df = get_team_comparison(selected_teams, minutes=30)
        fig = go.Figure()

        if not df.empty:
            for team in selected_teams:
                tdf = df[df["team_tag"] == team]
                if not tdf.empty:
                    fig.add_trace(go.Scatter(
                        x=tdf["bucket_time"], y=tdf["sentiment_score"],
                        name=team, mode="lines+markers",
                        line=dict(color=TEAM_COLORS.get(team, COLORS["accent"]), width=2),
                        marker=dict(size=4),
                    ))

        fig.update_layout(
            **PLOT_LAYOUT,
            yaxis=dict(**PLOT_LAYOUT["yaxis"], range=[-1, 1]),
        )
        return fig

    # ── Momentum gauge ──
    @app.callback(Output("momentum-gauge", "children"), Input("interval-fast", "n_intervals"))
    def update_momentum(n):
        score = get_momentum_score(seconds=30)

        # Determine color
        if score > 0.3:
            color = COLORS["positive"]
            label = "ELECTRIC 🔥"
        elif score > 0.1:
            color = COLORS["accent"]
            label = "POSITIVE ↑"
        elif score < -0.3:
            color = COLORS["negative"]
            label = "ANGRY 😤"
        elif score < -0.1:
            color = COLORS["accent2"]
            label = "NEGATIVE ↓"
        else:
            color = COLORS["neutral"]
            label = "NEUTRAL ●"

        fig = go.Figure(go.Indicator(
            mode="gauge+number",
            value=round(score * 100, 1),
            number={"suffix": "", "font": {"color": color, "size": 28, "family": "Orbitron"}},
            gauge=dict(
                axis=dict(range=[-100, 100], tickcolor=COLORS["text_dim"]),
                bar=dict(color=color, thickness=0.25),
                bgcolor="rgba(0,0,0,0)",
                borderwidth=0,
                steps=[
                    dict(range=[-100, -30], color="rgba(255,68,68,0.15)"),
                    dict(range=[-30, 30],   color="rgba(120,144,156,0.1)"),
                    dict(range=[30, 100],   color="rgba(0,230,118,0.15)"),
                ],
                threshold=dict(
                    line=dict(color=color, width=2),
                    thickness=0.75, value=score * 100
                ),
            ),
        ))
        fig.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            font=dict(color=COLORS["text"]),
            height=160, margin=dict(l=20, r=20, t=10, b=10),
        )

        return [
            dcc.Graph(figure=fig, config={"displayModeBar": False}),
            html.Div(label, style={
                "fontFamily": "Orbitron, sans-serif",
                "fontSize": "0.75rem",
                "color": color,
                "letterSpacing": "3px",
                "fontWeight": "700",
            }),
        ]

    # ── Match events ──
    @app.callback(Output("events-list", "children"), Input("interval-medium", "n_intervals"))
    def update_events(n):
        events = get_recent_events(limit=8)
        if not events:
            return html.P("No events detected yet.", style={"color": COLORS["text_dim"], "fontSize": ".8rem"})

        items = []
        for ev in events:
            icon = EVENT_ICON.get(ev.get("event_type", ""), "📌")
            ts = ev.get("timestamp", "")
            if ts:
                try:
                    ts = datetime.fromisoformat(ts).strftime("%H:%M:%S")
                except Exception:
                    pass
            items.append(html.Div([
                html.Span(icon, className="event-icon"),
                html.Div([
                    html.Div(ev.get("event_type", "").replace("_", " "), className="event-type"),
                    html.Div(ev.get("description", "")[:80] + "…" if len(ev.get("description", "")) > 80 else ev.get("description", ""), className="event-desc"),
                    html.Div(ts, className="event-time"),
                ]),
            ], className="event-item"))
        return items

    # ── Word cloud ──
    @app.callback(Output("wordcloud-container", "children"), Input("interval-slow", "n_intervals"))
    def update_wordcloud(n):
        freq = get_word_frequencies(minutes=10, top_n=50)
        if not freq:
            return [html.P("Collecting data…", style={"color": COLORS["text_dim"]})]

        max_freq = max(freq.values(), default=1)
        items = []
        colors = [COLORS["accent"], COLORS["positive"], COLORS["purple"], COLORS["gold"], COLORS["accent2"]]

        for i, (word, count) in enumerate(freq.items()):
            size = 0.7 + (count / max_freq) * 1.6
            color = colors[i % len(colors)]
            items.append(html.Span(
                word,
                style={
                    "fontSize": f"{size:.2f}rem",
                    "color": color,
                    "opacity": str(0.5 + (count / max_freq) * 0.5),
                    "fontWeight": "600" if count / max_freq > 0.5 else "400",
                    "padding": "2px 4px",
                    "cursor": "default",
                    "transition": "opacity .2s",
                }
            ))
        return items

    # ── Live feed ──
    @app.callback(Output("live-feed", "children"), Input("interval-fast", "n_intervals"))
    def update_feed(n):
        tweets = get_live_feed(limit=15)
        if not tweets:
            return [html.P("Waiting for tweets…", style={"color": COLORS["text_dim"], "padding": "12px"})]

        items = []
        for t in tweets:
            s = t.get("sentiment", "NEUTRAL")
            badge_cls = {"POSITIVE": "feed-pos", "NEGATIVE": "feed-neg"}.get(s, "feed-neu")
            badge_text = {"POSITIVE": "POS", "NEGATIVE": "NEG"}.get(s, "NEU")
            conf = t.get("confidence")
            conf_str = f"{conf:.0%}" if conf else ""

            meta_parts = []
            if t.get("username"):
                meta_parts.append(f"@{t['username']}")
            if t.get("team_tag"):
                meta_parts.append(f"#{t['team_tag']}")
            if t.get("emotion"):
                meta_parts.append(t["emotion"])
            if conf_str:
                meta_parts.append(conf_str)

            viral_badge = html.Span("🔥 VIRAL", className="feed-viral") if t.get("is_viral") else None

            items.append(html.Div([
                html.Span(badge_text, className=f"feed-badge {badge_cls}"),
                html.Div([
                    html.Div([
                        html.Span(t.get("text", "")[:160], className="feed-text"),
                        viral_badge,
                    ]),
                    html.Div(" · ".join(meta_parts), className="feed-meta"),
                ]),
            ], className="feed-item"))

        return items

    return app
