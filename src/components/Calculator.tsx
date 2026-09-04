"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isVaultCode, unlockVault } from "@/lib/vault";

export default function Calculator() {
  const [display, setDisplay] = useState("0");
  const [prevValue, setPrevValue] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [pendingSecondEqual, setPendingSecondEqual] = useState(false);
  const router = useRouter();
  const [equalTimeoutId, setEqualTimeoutId] = useState<number | null>(null);

  const normalizeNumber = (value: number) => {
    if (!Number.isFinite(value)) return "Error";
    return String(Number.parseFloat(value.toPrecision(12)));
  };

  const calculate = (left: number, right: number, currentOperator: string) => {
    switch (currentOperator) {
      case "+": return left + right;
      case "-": return left - right;
      case "×": return left * right;
      case "÷": return right === 0 ? Number.NaN : left / right;
      default: return right;
    }
  };

  const inputDigit = (digit: string) => {
    if (waitingForOperand || display === "Error") {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === "0" ? digit : display + digit);
    }
    setPendingSecondEqual(false);
    if (equalTimeoutId) window.clearTimeout(equalTimeoutId);
  };

  const inputDot = () => {
    if (waitingForOperand || display === "Error") {
      setDisplay("0.");
      setWaitingForOperand(false);
      return;
    }
    if (display.indexOf(".") === -1) setDisplay(display + ".");
    setPendingSecondEqual(false);
  };

  const clearAll = () => {
    setDisplay("0");
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setPendingSecondEqual(false);
  };

  const toggleSign = () => {
    if (display === "Error") return;
    const val = parseFloat(display);
    setDisplay(normalizeNumber(-val));
    setPendingSecondEqual(false);
  };

  const inputPercent = () => {
    if (display === "Error") return;
    const val = parseFloat(display);
    setDisplay(normalizeNumber(val / 100));
    setPendingSecondEqual(false);
  };

  const performOperation = (nextOperator: string) => {
    if (display === "Error") return;
    const inputValue = parseFloat(display);

    // Pressing operators repeatedly changes the pending operator instead of
    // calculating with the same operand twice.
    if (waitingForOperand) {
      setOperator(nextOperator);
      return;
    }

    if (prevValue == null) {
      setPrevValue(String(inputValue));
    } else if (operator) {
      const currentValue = parseFloat(prevValue);
      const newValue = calculate(currentValue, inputValue, operator);
      const normalized = normalizeNumber(newValue);
      setPrevValue(normalized);
      setDisplay(normalized);
    }
    setWaitingForOperand(true);
    setOperator(nextOperator);
    setPendingSecondEqual(false);
  };

  const handleEquals = () => {
    if (display === "Error") return;
    // Vault unlock logic: display == vault code && press "=="
    if (isVaultCode(display)) {
      if (pendingSecondEqual) {
        // second = : unlock
        if (equalTimeoutId) window.clearTimeout(equalTimeoutId);
        setPendingSecondEqual(false);
        unlockVault();
        router.push("/login");
        return;
      } else {
        // first = : wait for second
        setPendingSecondEqual(true);
        // auto reset after 1.5s
        if (equalTimeoutId) window.clearTimeout(equalTimeoutId);
        setEqualTimeoutId(window.setTimeout(() => {
          setPendingSecondEqual(false);
          // normal equals behavior not needed for vault code, just keep display
        }, 1500));
        return;
      }
    }

    // normal calculator equals
    setPendingSecondEqual(false);
    if (equalTimeoutId) window.clearTimeout(equalTimeoutId);
    if (operator && prevValue != null) {
      const result = calculate(parseFloat(prevValue), parseFloat(display), operator);
      const normalized = normalizeNumber(result);
      if (normalized === "Error") {
        setDisplay("Error");
        setPrevValue(null);
        setOperator(null);
        setWaitingForOperand(false);
        return;
      }
      setDisplay(normalized);
      setOperator(null);
      setPrevValue(null);
      setWaitingForOperand(true);
    }
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) inputDigit(event.key);
      else if (event.key === ".") inputDot();
      else if (event.key === "Enter" || event.key === "=") handleEquals();
      else if (event.key === "Escape") clearAll();
      else if (event.key === "+" || event.key === "-" || event.key === "*" || event.key === "/") {
        event.preventDefault();
        performOperation(event.key === "*" ? "×" : event.key === "/" ? "÷" : event.key);
      } else if (event.key === "%") inputPercent();
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  const buttons: Array<{ label: string; className: string; onClick: () => void }> = [
    { label: "AC", className: "bg-[#a5a5a5] text-black", onClick: clearAll },
    { label: "±", className: "bg-[#a5a5a5] text-black", onClick: toggleSign },
    { label: "%", className: "bg-[#a5a5a5] text-black", onClick: inputPercent },
    { label: "÷", className: "bg-[#ff9f0a] text-white", onClick: () => performOperation("÷") },
    { label: "7", className: "bg-[#333333] text-white", onClick: () => inputDigit("7") },
    { label: "8", className: "bg-[#333333] text-white", onClick: () => inputDigit("8") },
    { label: "9", className: "bg-[#333333] text-white", onClick: () => inputDigit("9") },
    { label: "×", className: "bg-[#ff9f0a] text-white", onClick: () => performOperation("×") },
    { label: "4", className: "bg-[#333333] text-white", onClick: () => inputDigit("4") },
    { label: "5", className: "bg-[#333333] text-white", onClick: () => inputDigit("5") },
    { label: "6", className: "bg-[#333333] text-white", onClick: () => inputDigit("6") },
    { label: "-", className: "bg-[#ff9f0a] text-white", onClick: () => performOperation("-") },
    { label: "1", className: "bg-[#333333] text-white", onClick: () => inputDigit("1") },
    { label: "2", className: "bg-[#333333] text-white", onClick: () => inputDigit("2") },
    { label: "3", className: "bg-[#333333] text-white", onClick: () => inputDigit("3") },
    { label: "+", className: "bg-[#ff9f0a] text-white", onClick: () => performOperation("+") },
    { label: "0", className: "bg-[#333333] text-white col-span-2 !justify-start pl-8", onClick: () => inputDigit("0") },
    { label: ".", className: "bg-[#333333] text-white", onClick: inputDot },
    { label: "=", className: "bg-[#ff9f0a] text-white", onClick: handleEquals },
  ];

  // format display with commas for realism
  const formattedDisplay = (() => {
    if (display === "Error") return display;
    // don't format if contains operator hint
    const n = Number(display);
    if (!Number.isFinite(n)) return "Error";
    // keep exact string for vault code (don't add commas if it's the code)
    if (isVaultCode(display)) return display;
    // limit length
    if (display.length > 9) {
      const exp = n.toExponential(6);
      return exp;
    }
    return display;
  })();

  return (
    <div className="min-h-[100dvh] bg-[#1c1c1e] flex flex-col items-center justify-end pb-8 px-4 select-none">
      <div className="w-full max-w-[320px]">
        {/* Display */}
        <div className="h-32 flex flex-col justify-end items-end pb-4 pr-2">
          <div className="text-[64px] font-extralight text-white leading-none tracking-tight overflow-hidden text-right w-full">
            {formattedDisplay}
          </div>

        </div>

        {/* Keypad */}
        <div className="grid grid-cols-4 gap-3">
          {buttons.map((b) => (
            <button
              key={b.label + b.className}
              onClick={b.onClick}
              className={`h-[72px] rounded-full text-[28px] font-medium flex items-center justify-center active:brightness-125 transition ${b.className} ${b.label === "0" ? "col-span-2" : ""}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="flex justify-center mt-6">
          <div className="w-32 h-1 bg-white rounded-full opacity-80" />
        </div>
      </div>
    </div>
  );
}
