"use client";
import { useState, useMemo, useEffect } from "react";

// ---- helpers ----
const STORAGE_KEY = "shift-calendar-data";
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];

function toKey(date) {
  // Use local date parts (toISOString would shift the day in timezones like Japan)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

function getMonthGrid(year, month) {
  // month is 0-indexed
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function toMinutesHM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Core pay calculation: raw worked time, break deducted by bracket, decimal hours
function computeShiftPay(start, end) {
  const startMin = toMinutesHM(start);
  let endMin = toMinutesHM(end);
  if (endMin <= startMin) endMin += 24 * 60; // overnight wrap, real duration

  const rawMinutes = endMin - startMin;

  // Break bracket uses a rounded-up end time, but only for the specific
  // closing time of 23:45 — staying until close counts as reaching 24:00
  // for break purposes. Any other end time is used as-is.
  const [eh, em] = end.split(":").map(Number);
  let breakEndMin = eh * 60 + em;
  if (eh === 23 && em === 45) breakEndMin = 24 * 60;
  if (breakEndMin <= startMin) breakEndMin += 24 * 60;
  const breakCalcHours = (breakEndMin - startMin) / 60;

  let breakMinutes = 0;
  if (breakCalcHours >= 8) breakMinutes = 60;
  else if (breakCalcHours >= 7) breakMinutes = 45;
  else if (breakCalcHours >= 6) breakMinutes = 30;
  else if (breakCalcHours >= 5) breakMinutes = 15;

  const paidMinutes = Math.max(0, rawMinutes - breakMinutes);
  const paidDecimal = paidMinutes / 60;

  return { rawMinutes, breakMinutes, paidMinutes, paidDecimal };
}

function durationLabel(start, end) {
  const { paidDecimal } = computeShiftPay(start, end);
  return paidDecimal.toFixed(2);
}

// ---- modal ----
function ShiftModal({ date, existing, onSave, onClose }) {
  const [start, setStart] = useState(existing?.start || "09:00");
  const [end, setEnd] = useState(existing?.end || "17:00");
  const [noWork, setNoWork] = useState(existing?.noWork || false);

  const [startH, startM] = start.split(":");
  const [endH, endM] = end.split(":");

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>
          {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </h3>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={noWork}
            onChange={(e) => setNoWork(e.target.checked)}
          />
          No work this day
        </label>

        <fieldset disabled={noWork} style={styles.timeFields}>
          <div style={styles.timeRow}>
            <span style={styles.timeLabel}>Start</span>
            <select value={startH} onChange={(e) => setStart(`${e.target.value}:${startM}`)}>
              {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <select value={startM} onChange={(e) => setStart(`${startH}:${e.target.value}`)}>
              {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div style={styles.timeRow}>
            <span style={styles.timeLabel}>End</span>
            <select value={endH} onChange={(e) => setEnd(`${e.target.value}:${endM}`)}>
              {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <select value={endM} onChange={(e) => setEnd(`${endH}:${e.target.value}`)}>
              {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </fieldset>

        {!noWork && (
          <div style={styles.previewBox}>
            {(() => {
              const { breakMinutes, paidDecimal } = computeShiftPay(start, end);
              return (
                <>
                  Break: {breakMinutes} min &nbsp;·&nbsp; Paid: <strong>{paidDecimal.toFixed(2)} hrs</strong>
                </>
              );
            })()}
          </div>
        )}

        <div style={styles.modalActions}>
          <button style={styles.btnGhost} onClick={onClose}>Cancel</button>
          <button
            style={styles.btnPrimary}
            onClick={() => onSave({ start, end, noWork })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- main component ----
export default function ShiftCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [shifts, setShifts] = useState({}); // { 'YYYY-MM-DD': {start, end, noWork} }
  const [selectedDate, setSelectedDate] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Load saved shifts once, after the page mounts in the browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setShifts(JSON.parse(saved));
    } catch (err) {
      console.error("Could not load saved shifts:", err);
    }
    setLoaded(true);
  }, []);

  // Save whenever shifts change (but only after the initial load finished,
  // otherwise the empty starting state would overwrite your saved data)
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shifts));
    } catch (err) {
      console.error("Could not save shifts:", err);
    }
  }, [shifts, loaded]);

  const weeks = useMemo(() => getMonthGrid(year, month), [year, month]);

  const monthlyTotal = useMemo(() => {
    let totalHours = 0;
    let totalBreakMin = 0;
    weeks.flat().forEach((date) => {
      if (!date || date.getMonth() !== month) return;
      const shift = shifts[toKey(date)];
      if (!shift || shift.noWork) return;
      const { paidDecimal, breakMinutes } = computeShiftPay(shift.start, shift.end);
      totalHours += paidDecimal;
      totalBreakMin += breakMinutes;
    });
    return { totalHours, totalBreakMin };
  }, [weeks, shifts, month]);

  const WEEKLY_CAP = 28;

  const rollingWeeks = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const windows = [];
    for (let startDay = 1; startDay + 6 <= daysInMonth; startDay++) {
      let total = 0;
      for (let d = startDay; d < startDay + 7; d++) {
        const date = new Date(year, month, d);
        const shift = shifts[toKey(date)];
        if (!shift || shift.noWork) continue;
        total += computeShiftPay(shift.start, shift.end).paidDecimal;
      }
      windows.push({ startDay, endDay: startDay + 6, total });
    }
    return windows;
  }, [year, month, shifts]);

  // Assign a vertical "lane" to each over-cap window so overlapping ranges
  // (e.g. 12-18 and 15-21 both over cap) stack instead of colliding.
  const overWeeks = useMemo(() => {
    const over = rollingWeeks.filter((w) => w.total > WEEKLY_CAP);
    const laneEnds = []; // laneEnds[level] = endDay of the last window placed there
    return over
      .slice()
      .sort((a, b) => a.startDay - b.startDay)
      .map((w) => {
        let level = 0;
        while (laneEnds[level] !== undefined && laneEnds[level] >= w.startDay) level++;
        laneEnds[level] = w.endDay;
        return { ...w, level };
      });
  }, [rollingWeeks]);

  const PILL_HEIGHT = 6;
  const PILL_GAP = 3;
  const maxPillLevel = overWeeks.length ? Math.max(...overWeeks.map((w) => w.level)) : -1;
  const pillAreaHeight = maxPillLevel >= 0 ? (maxPillLevel + 1) * (PILL_HEIGHT + PILL_GAP) : 0;


  function changeMonth(delta) {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  }

  function handleSave(data) {
    const key = toKey(selectedDate);
    setShifts((prev) => ({ ...prev, [key]: data }));
    setSelectedDate(null);
  }

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div style={styles.wrap} className="p-3">
      <div style={styles.header}>
        <button style={styles.navBtn} onClick={() => changeMonth(-1)}>‹</button>
        <h2 style={styles.monthLabel}>{monthLabel}</h2>
        <button style={styles.navBtn} onClick={() => changeMonth(1)}>›</button>
      </div>

      <div style={styles.weekdayRow}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} style={styles.weekdayCell}>{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => {
        // Which over-cap windows touch this calendar row, and at which
        // column range within it (so the pill only covers the right cells).
        const rowPills = overWeeks
          .map((w) => {
            const cols = [];
            week.forEach((date, di) => {
              if (
                date &&
                date.getMonth() === month &&
                date.getDate() >= w.startDay &&
                date.getDate() <= w.endDay
              ) {
                cols.push(di);
              }
            });
            if (cols.length === 0) return null;
            return { ...w, minCol: Math.min(...cols), maxCol: Math.max(...cols) };
          })
          .filter(Boolean);

        return (
          <div key={wi} style={styles.weekRowWrap}>
            <div style={styles.weekRow}>
              {week.map((date, di) => {
                if (!date) return <div key={di} style={styles.emptyCell} />;
                const key = toKey(date);
                const shift = shifts[key];
                return (
                  <div
                    key={di}
                    style={styles.dayCell}
                    onClick={() => setSelectedDate(date)}
                  >
                    <div style={styles.dayNumber}>{date.getDate()}</div>
                    {shift?.noWork && <div style={styles.offTag}>Off</div>}
                    {shift && !shift.noWork && (
                      <div style={styles.shiftTag}>
                        {shift.start}–{shift.end}
                        <div style={styles.durationText}>{durationLabel(shift.start, shift.end)} hrs</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {pillAreaHeight > 0 && <div style={{ height: pillAreaHeight }} />}

            {rowPills.map((p) => (
              <div
                key={p.startDay}
                title={`Day ${p.startDay}–${p.endDay}: ${p.total.toFixed(2)} hrs (over ${WEEKLY_CAP}h cap)`}
                style={{
                  position: "absolute",
                  left: `${(p.minCol / 7) * 100}%`,
                  width: `${((p.maxCol - p.minCol + 1) / 7) * 100}%`,
                  top: `calc(100% - ${pillAreaHeight}px + ${p.level * (PILL_HEIGHT + PILL_GAP)}px)`,
                  height: PILL_HEIGHT,
                  background: "#e04b3f",
                  borderRadius: 999,
                }}
              />
            ))}
          </div>
        );
      })}

      <div style={styles.footer}>
        <strong>{monthlyTotal.totalHours.toFixed(2)} hrs</strong> paid this month
        <span style={styles.footerSub}>
          ({(monthlyTotal.totalBreakMin / 60).toFixed(2)} hrs of break deducted)
        </span>
      </div>

      <div style={styles.weeklyTableWrap}>
        <h3 style={styles.weeklyTableTitle}>Rolling 7-day totals (cap: {WEEKLY_CAP} hrs)</h3>
        <div style={styles.weeklyGrid}>
          {rollingWeeks.map((w) => {
            const over = w.total > WEEKLY_CAP;
            return (
              <div
                key={w.startDay}
                style={over ? styles.weeklyCardOver : styles.weeklyCard}
              >
                <div style={styles.weeklyCardRange}>{w.startDay} – {w.endDay}</div>
                <div style={styles.weeklyCardHours}>{w.total.toFixed(2)} hrs</div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <ShiftModal
          date={selectedDate}
          existing={shifts[toKey(selectedDate)]}
          onSave={handleSave}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}

// ---- inline styles (no CSS setup required) ----
const styles = {
  wrap: { fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  monthLabel: { fontSize: "1.1rem", fontWeight: 500, margin: 0 },
  navBtn: { border: "1px solid #ddd", background: "white", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: "1rem" },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 },
  weekdayCell: { textAlign: "center", fontSize: "0.75rem", color: "#888", padding: "4px 0" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 },
  weekRowWrap: { position: "relative", marginBottom: 2 },
  emptyCell: { minHeight: 64 },
  dayCell: {
    minHeight: 64, border: "1px solid #e5e5e5", borderRadius: 8, padding: 6,
    cursor: "pointer", background: "white", transition: "background 0.15s",
  },
  dayNumber: { fontSize: "0.8rem", color: "#555" },
  shiftTag: { marginTop: 4, fontSize: "0.72rem", background: "#e4ede9", color: "#2f5d50", borderRadius: 4, padding: "2px 4px" },
  durationText: { fontSize: "0.65rem", color: "#5a8a78" },
  offTag: { marginTop: 4, fontSize: "0.72rem", background: "#f0f0f0", color: "#888", borderRadius: 4, padding: "2px 4px", display: "inline-block" },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
  },
  modal: { background: "white", borderRadius: 10, padding: 24, width: 320, maxWidth: "90vw" },
  modalTitle: { marginTop: 0, marginBottom: 16, fontSize: "1rem" },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem", marginBottom: 16 },
  timeFields: { border: "none", padding: 0, margin: 0 },
  timeRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  timeLabel: { width: 44, fontSize: "0.85rem", color: "#666" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  btnGhost: { border: "1px solid #ddd", background: "white", borderRadius: 6, padding: "6px 14px", cursor: "pointer" },
  btnPrimary: { border: "none", background: "#2f5d50", color: "white", borderRadius: 6, padding: "6px 14px", cursor: "pointer" },
  previewBox: { background: "#e4ede9", color: "#2f5d50", borderRadius: 6, padding: "8px 10px", fontSize: "0.85rem", marginTop: 4, marginBottom: 4 },
  footer: { marginTop: 16, padding: "12px 14px", background: "#f6f5f2", borderRadius: 8, fontSize: "0.9rem" },
  footerSub: { color: "#888", fontSize: "0.8rem", marginLeft: 8 },
  weeklyTableWrap: { marginTop: 20 },
  weeklyTableTitle: { fontSize: "0.9rem", fontWeight: 500, marginBottom: 8, color: "#444" },
  weeklyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 6 },
  weeklyCard: {
    border: "1px solid #e5e5e5", borderRadius: 8, padding: "8px 10px",
    background: "white", textAlign: "center",
  },
  weeklyCardOver: {
    border: "1px solid #e39a93", borderRadius: 8, padding: "8px 10px",
    background: "#fdecea", textAlign: "center",
  },
  weeklyCardRange: { fontSize: "0.75rem", color: "#888" },
  weeklyCardHours: { fontSize: "0.95rem", fontWeight: 500, marginTop: 2, color: "#222" },
};
