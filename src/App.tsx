import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Trash2, 
  CornerDownLeft, 
  Delete, 
  FileText
} from "lucide-react";
import "./App.css";

interface TapeEntry {
  id: string;
  expr: string;
  result: string;
}

function App() {
  // --- STATE ---
  const [input, setInput] = useState<string>("0");
  const [prevCalculation, setPrevCalculation] = useState<string>("");
  const [justResult, setJustResult] = useState<boolean>(false);
  
  // History Paper Roll State
  const [history, setHistory] = useState<TapeEntry[]>(() => {
    const saved = localStorage.getItem("calculator_history");
    return saved ? JSON.parse(saved) : [];
  });
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Settings & Toggles (Saved in localStorage)
  const [skin, setSkin] = useState<'beige' | 'crt' | 'synthwave'>(() => {
    return (localStorage.getItem("calculator_skin") as any) || 'beige';
  });
  const [sound, setSound] = useState<boolean>(() => {
    const saved = localStorage.getItem("calculator_sound");
    return saved !== "false";
  });
  const [scientific, setScientific] = useState<boolean>(() => {
    return localStorage.getItem("calculator_scientific") === "true";
  });
  const [isRad, setIsRad] = useState<boolean>(() => {
    return localStorage.getItem("calculator_rad") !== "false";
  });

  // Physical Board LEDs
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isError, setIsError] = useState<boolean>(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Ref to automatically scroll paper tape to bottom
  const paperScrollRef = useRef<HTMLDivElement>(null);

  // --- AUDIO SYNTHESIS VIA WEB AUDIO API ---
  const playSound = (type: 'key' | 'lever' | 'paper') => {
    if (!sound) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      if (type === 'key') {
        // Satisfying mechanical key click: combination of triangle pitch sweep and transient highpass noise
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(650, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.04);
        
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.04);
        
        // High-frequency noise burst for keyboard key click tactile snap
        const bufferSize = audioCtx.sampleRate * 0.015; // 15ms
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(3200, audioCtx.currentTime);
        
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.015);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(audioCtx.destination);
        noise.start();
        noise.stop(audioCtx.currentTime + 0.015);
      } else if (type === 'lever') {
        // Satisfying thick metallic click for physical toggles/levers
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(30, audioCtx.currentTime + 0.12);
        
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } else if (type === 'paper') {
        // Satisfying low paper rolling feed hum
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(50, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      }
    } catch (e) {
      console.error("Audio Synthesis error: ", e);
    }
  };

  // Auto-scroll paper roll
  useEffect(() => {
    if (paperScrollRef.current) {
      paperScrollRef.current.scrollTop = paperScrollRef.current.scrollHeight;
    }
  }, [history, drawerOpen]);

  // Save preferences
  useEffect(() => {
    localStorage.setItem("calculator_skin", skin);
  }, [skin]);

  useEffect(() => {
    localStorage.setItem("calculator_sound", sound.toString());
  }, [sound]);

  useEffect(() => {
    localStorage.setItem("calculator_scientific", scientific.toString());
  }, [scientific]);

  useEffect(() => {
    localStorage.setItem("calculator_rad", isRad.toString());
  }, [isRad]);

  // --- FLOATING FLOAT CORRECTION FORMATTER ---
  const formatResult = (val: number): string => {
    if (isNaN(val) || !isFinite(val)) {
      throw new Error("Invalid output");
    }
    if (Number.isInteger(val)) {
      return val.toString();
    }
    const abs = Math.abs(val);
    if (abs >= 1e12 || (abs > 0 && abs < 1e-9)) {
      return val.toExponential(6);
    }
    // ROUND UP to 10 decimal digits to filter IEEE 754 precision bugs (e.g. 0.1+0.2=0.30000000000000004)
    const fixedVal = val.toFixed(10);
    return Number(fixedVal).toString(); // removes trailing zeros automatically
  };

  // --- CORE EVALUATION HANDLER ---
  const handleEvaluate = async (expressionToEval: string) => {
    if (!expressionToEval || expressionToEval === "0" || expressionToEval === "ERROR") return;
    
    setIsBusy(true);
    setIsError(false);
    
    try {
      // Invoke the recursive parser in Rust backend
      const res = await invoke<number>("evaluate_expression", { 
        expression: expressionToEval, 
        isRad 
      });
      
      const formatted = formatResult(res);
      
      // Update history tape
      const entry: TapeEntry = {
        id: Date.now().toString(),
        expr: expressionToEval,
        result: formatted
      };
      
      setHistory(prev => {
        const next = [...prev, entry];
        localStorage.setItem("calculator_history", JSON.stringify(next));
        return next;
      });

      setPrevCalculation(expressionToEval + " =");
      setInput(formatted);
      setJustResult(true);
      playSound("paper");
    } catch (err: any) {
      console.error("Rust math evaluation failed:", err);
      setInput("ERROR");
      setIsError(true);
      setJustResult(true);
      playSound("key");
    } finally {
      setIsBusy(false);
    }
  };

  // --- BUTTON PRESS ROUTER ---
  const handleBtnPress = (val: string) => {
    playSound("key");

    if (val === "AC") {
      setInput("0");
      setPrevCalculation("");
      setJustResult(false);
      setIsError(false);
      return;
    }

    if (val === "DEL") {
      if (justResult || input === "ERROR") {
        setInput("0");
        setPrevCalculation("");
        setJustResult(false);
        setIsError(false);
      } else {
        if (input.length <= 1) {
          setInput("0");
        } else {
          setInput(input.slice(0, -1));
        }
      }
      return;
    }

    if (val === "=") {
      handleEvaluate(input);
      return;
    }

    // Toggle degree mode
    if (val === "RAD" || val === "DEG") {
      playSound("lever");
      setIsRad(prev => !prev);
      return;
    }

    // Helper functions inserting
    const isFunc = ["sin(", "cos(", "tan(", "ln(", "log(", "sqrt("].includes(val);
    
    // Check if appending or starting fresh
    const operators = ["+", "−", "×", "÷", "^", "%"];
    const isOperator = operators.includes(val);

    if (justResult || input === "ERROR") {
      setIsError(false);
      if (isOperator && input !== "ERROR") {
        // Chain calculation using previous answer
        setInput(input + " " + val + " ");
        setPrevCalculation("");
        setJustResult(false);
      } else {
        // Start fresh calculation
        setInput(val);
        setPrevCalculation("");
        setJustResult(false);
      }
    } else {
      if (input === "0") {
        if (isOperator) {
          setInput("0 " + val + " ");
        } else if (isFunc || val === "(" || val === ")" || val === "pi" || val === "e") {
          setInput(val);
        } else {
          setInput(val);
        }
      } else {
        if (isOperator) {
          setInput(input + " " + val + " ");
        } else {
          setInput(input + val);
        }
      }
    }
  };

  // --- HARDWARE DIAL & TOGGLE CLICK HANDLERS ---
  const handleSoundToggle = () => {
    const nextVal = !sound;
    setSound(nextVal);
    // play the sound using next state to ensure lever click works on turning back on
    if (nextVal) {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(30, audioCtx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
      } catch (e) {}
    } else {
      playSound("lever");
    }
  };

  const handleScientificToggle = () => {
    playSound("lever");
    setScientific(prev => !prev);
  };

  const handleSkinSelect = (selected: 'beige' | 'crt' | 'synthwave') => {
    if (selected === skin) return;
    playSound("lever");
    setSkin(selected);
  };

  const handleClearHistory = () => {
    playSound("lever");
    setHistory([]);
    localStorage.removeItem("calculator_history");
  };

  // --- PHYSICAL KEYBOARD KEYBOARD CAPTURE ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent browser default hotkeys for input
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
      }
      if (e.key === "/" || e.key === "'") {
        e.preventDefault();
      }

      let keyMapped: string | null = null;

      if (e.key >= "0" && e.key <= "9") {
        keyMapped = e.key;
      } else if (e.key === ".") {
        keyMapped = ".";
      } else if (e.key === "+") {
        keyMapped = "+";
      } else if (e.key === "-") {
        keyMapped = "−";
      } else if (e.key === "*") {
        keyMapped = "×";
      } else if (e.key === "/") {
        keyMapped = "÷";
      } else if (e.key === "%") {
        keyMapped = "%";
      } else if (e.key === "^") {
        keyMapped = "^";
      } else if (e.key === "(") {
        keyMapped = "(";
      } else if (e.key === ")") {
        keyMapped = ")";
      } else if (e.key === "Enter" || e.key === "=") {
        keyMapped = "=";
      } else if (e.key === "Backspace") {
        keyMapped = "DEL";
      } else if (e.key === "Escape" || e.key === "c" || e.key === "C") {
        keyMapped = "AC";
      } else if (e.key === "r" || e.key === "R") {
        keyMapped = "RAD";
      }

      if (keyMapped) {
        handleBtnPress(keyMapped);
        setActiveKey(keyMapped);
        setTimeout(() => setActiveKey(null), 120);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [input, justResult, sound, isRad]);

  // Helper checking keyboard-active class
  const getBtnClass = (val: string, baseClass = "retro-btn") => {
    const isActive = activeKey === val;
    return `${baseClass} ${isActive ? "keyboard-pressed" : ""}`;
  };

  return (
    <div className={`theme-${skin}`}>
      <div className="desktop-wrapper">
        
        {/* SIDEBAR SKIN SELECTORS */}
        <div className="sidebar-panel">
          <div className="vintage-dial-card">
            <span className="dial-title">Skins</span>
            <div className="skin-button-group">
              <button 
                className={`skin-push-btn btn-skin-beige ${skin === 'beige' ? 'active' : ''}`}
                onClick={() => handleSkinSelect('beige')}
                title="IBM Beige Classic 1984"
              />
              <button 
                className={`skin-push-btn btn-skin-crt ${skin === 'crt' ? 'active' : ''}`}
                onClick={() => handleSkinSelect('crt')}
                title="Fallout Phosphor CRT"
              />
              <button 
                className={`skin-push-btn btn-skin-synthwave ${skin === 'synthwave' ? 'active' : ''}`}
                onClick={() => handleSkinSelect('synthwave')}
                title="Synthwave Neon Sunset 1988"
              />
            </div>
          </div>
        </div>

        {/* MAIN CALCULATOR FRAME */}
        <div className="calculator-case">
          {/* Screws for Retromorphic style */}
          <div className="case-screw screw-tl" />
          <div className="case-screw screw-tr" />
          <div className="case-screw screw-bl" />
          <div className="case-screw screw-br" />

          {/* PAPER TAPE MOUNT & PULL-OUT HANDLE */}
          <div className="tape-slot-mount">
            <div className="tape-slot-line" />
          </div>

          <button 
            className="tape-handle-tab"
            onClick={() => { playSound("lever"); setDrawerOpen(!drawerOpen); }}
          >
            <FileText size={10} />
            {drawerOpen ? "Close Tape" : "View Tape"}
          </button>

          {/* HISTORY PAPER STRIP TAPE */}
          <div className={`history-paper-strip ${drawerOpen ? 'drawer-open' : ''}`} ref={paperScrollRef}>
            <div className="paper-inner">
              <div style={{ textAlign: 'center', fontSize: '9px', marginBottom: '8px', color: '#888' }}>
                *** AG-1984 PAPER ROLL ***
              </div>
              
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#9a9482', fontStyle: 'italic', fontSize: '11px', margin: '20px 0' }}>
                  Tape Empty
                </div>
              ) : (
                history.map((t) => (
                  <div key={t.id} style={{ marginBottom: '6px' }}>
                    <div className="paper-line">
                      <span className="paper-expr">{t.expr}</span>
                    </div>
                    <div className="paper-line">
                      <span className="paper-res">{t.result} ⚡</span>
                    </div>
                  </div>
                ))
              )}

              <div className="paper-rip-line">- - T E A R - -</div>
              
              {history.length > 0 && (
                <div className="paper-actions">
                  <button className="paper-btn" onClick={handleClearHistory}>
                    <Trash2 size={10} style={{ marginRight: '3px' }} /> Clear Tape
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* SOLAR PANEL & PLAQUE PLACEMENT */}
          <div className="top-deck">
            {/* Glossy Solar Grid */}
            <div className="solar-panel" title="Ambient Solar Cell Power">
              <div className="solar-cell" />
              <div className="solar-cell" />
              <div className="solar-cell" />
              <div className="solar-cell" />
            </div>

            {/* Retro Plaque */}
            <div className="brand-plaque">
              <span className="brand-text">Antigravity</span>
              <span className="brand-subtext">MODEL AG-1984</span>
            </div>
          </div>

          {/* RETROMORPHIC DISPLAY SCREEN */}
          <div className="screen-bezel">
            <div className="screen-container">
              <div className="screen-overlay" />
              <div className="screen-glare" />
              
              {/* Top row showing equations & degrees indicators */}
              <div className="screen-row-top">
                <div className="screen-expression" title={prevCalculation}>
                  {prevCalculation}
                </div>
                <div className="screen-indicators">
                  <span className={isRad ? "indicator-active" : "indicator-inactive"}>RAD</span>
                  <span className={!isRad ? "indicator-active" : "indicator-inactive"}>DEG</span>
                </div>
              </div>
              
              {/* Bottom display value */}
              <div className="screen-display">
                {input}
              </div>
            </div>
          </div>

          {/* MECHANICAL SWITCHBOARD INTERFACE (LEDs & LEVERS) */}
          <div className="board-interface">
            <div className="led-panel">
              <div className="led-group">
                <span className="led-label">Busy</span>
                <div className={`led-light ${isBusy ? 'active-busy' : ''}`} />
              </div>
              <div className="led-group">
                <span className="led-label">Error</span>
                <div className={`led-light ${isError ? 'active-error' : ''}`} />
              </div>
              <div className="led-group">
                <span className="led-label">Rad</span>
                <div className={`led-light ${isRad ? 'active-rad' : ''}`} />
              </div>
            </div>

            <div className="toggle-controls">
              {/* Sound rocker dial */}
              <div className="retro-toggle">
                <span className="led-label">Sound</span>
                <div 
                  className={`toggle-track ${sound ? 'active' : ''}`}
                  onClick={handleSoundToggle}
                  title="Toggle Mechanical Sounds"
                >
                  <div className="toggle-slider" />
                </div>
              </div>

              {/* Scientific keypad slider lever */}
              <div className="retro-toggle">
                <span className="led-label">Scientific</span>
                <div 
                  className={`toggle-track ${scientific ? 'active' : ''}`}
                  onClick={handleScientificToggle}
                  title="Toggle Scientific Keypad Drawer"
                >
                  <div className="toggle-slider" />
                </div>
              </div>
            </div>
          </div>

          {/* DYNAMIC RETRO KEYBOARD GRID */}
          <div className={`keypad-container ${scientific ? 'scientific-drawer-open' : ''}`}>
            
            {/* MAIN NUMERIC & BASIC OPERATORS GRID */}
            <div className="keygrid">
              
              {/* AC Key */}
              <button 
                className={getBtnClass("AC", "retro-btn btn-special")} 
                onClick={() => handleBtnPress("AC")}
              >
                AC
              </button>
              
              {/* Backspace Delete */}
              <button 
                className={getBtnClass("DEL", "retro-btn btn-special")} 
                onClick={() => handleBtnPress("DEL")}
                title="Backspace"
              >
                <Delete size={18} />
              </button>

              {/* Radian/Degree toggle button */}
              <button 
                className={getBtnClass("RAD", "retro-btn btn-operator")} 
                onClick={() => handleBtnPress("RAD")}
                title="Radian/Degree Selector"
              >
                {isRad ? "DEG" : "RAD"}
              </button>

              {/* Division */}
              <button 
                className={getBtnClass("÷", "retro-btn btn-operator")} 
                onClick={() => handleBtnPress("÷")}
              >
                ÷
              </button>

              {/* Numbers and Multiplication row */}
              <button className={getBtnClass("7")} onClick={() => handleBtnPress("7")}>7</button>
              <button className={getBtnClass("8")} onClick={() => handleBtnPress("8")}>8</button>
              <button className={getBtnClass("9")} onClick={() => handleBtnPress("9")}>9</button>
              
              <button 
                className={getBtnClass("×", "retro-btn btn-operator")} 
                onClick={() => handleBtnPress("×")}
              >
                ×
              </button>

              {/* Numbers and Subtraction row */}
              <button className={getBtnClass("4")} onClick={() => handleBtnPress("4")}>4</button>
              <button className={getBtnClass("5")} onClick={() => handleBtnPress("5")}>5</button>
              <button className={getBtnClass("6")} onClick={() => handleBtnPress("6")}>6</button>
              
              <button 
                className={getBtnClass("−", "retro-btn btn-operator")} 
                onClick={() => handleBtnPress("−")}
              >
                −
              </button>

              {/* Numbers and Addition row */}
              <button className={getBtnClass("1")} onClick={() => handleBtnPress("1")}>1</button>
              <button className={getBtnClass("2")} onClick={() => handleBtnPress("2")}>2</button>
              <button className={getBtnClass("3")} onClick={() => handleBtnPress("3")}>3</button>
              
              <button 
                className={getBtnClass("+", "retro-btn btn-operator")} 
                onClick={() => handleBtnPress("+")}
              >
                +
              </button>

              {/* Decimal, Zero, Equals */}
              <button className={getBtnClass("0")} onClick={() => handleBtnPress("0")}>0</button>
              <button className={getBtnClass(".")} onClick={() => handleBtnPress(".")}>.</button>
              
              <button 
                className={getBtnClass("=", "retro-btn btn-equal span-two")} 
                onClick={() => handleBtnPress("=")}
              >
                <CornerDownLeft size={16} style={{ marginRight: '4px' }} /> =
              </button>

            </div>

            {/* EXTENDED SCIENTIFIC DRAWER PANEL */}
            <div className="scientific-drawer">
              
              <button 
                className={getBtnClass("sqrt(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("sqrt(")}
              >
                √
              </button>
              <button 
                className={getBtnClass("^", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("^")}
              >
                x<sup>y</sup>
              </button>

              <button 
                className={getBtnClass("sin(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("sin(")}
              >
                sin
              </button>
              <button 
                className={getBtnClass("cos(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("cos(")}
              >
                cos
              </button>

              <button 
                className={getBtnClass("tan(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("tan(")}
              >
                tan
              </button>
              <button 
                className={getBtnClass("log(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("log(")}
              >
                log
              </button>

              <button 
                className={getBtnClass("ln(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("ln(")}
              >
                ln
              </button>
              <button 
                className={getBtnClass("pi", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("pi")}
              >
                π
              </button>

              <button 
                className={getBtnClass("e", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("e")}
              >
                e
              </button>
              <button 
                className={getBtnClass("%", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("%")}
              >
                mod
              </button>

              <button 
                className={getBtnClass("(", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress("(")}
              >
                (
              </button>
              <button 
                className={getBtnClass(")", "retro-btn btn-scientific")} 
                onClick={() => handleBtnPress(")")}
              >
                )
              </button>

            </div>

          </div>

          {/* PHYSICAL KEYBOARD HINT FOOTER */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
            <span className="keyboard-hint">
              ★ SUPPORTING PHYSICAL KEYBOARD INPUT ★
            </span>
          </div>

        </div>

      </div>
    </div>
  );
}

export default App;
