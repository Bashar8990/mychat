"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { isVaultCode, unlockVault } from "@/lib/vault";

export default function Calculator() {
  const [display, setDisplay] = useState("0");
  const [prevValue, setPrevValue] = useState<string | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [pendingSecondEqual, setPendingSecondEqual] = useState(false);
  const router = useRouter();
  const equalTimeoutRef = useRef<number | null>(null);

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === "0" ? digit : display + digit);
    }
    setPendingSecondEqual(false);
    if (equalTimeoutRef.current) window.clearTimeout(equalTimeoutRef.current);
  };

  const inputDot = () => {
    if (waitingForOperand) {
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
    const val = parseFloat(display);
    setDisplay(String(-val));
    setPendingSecondEqual(false);
  };

  const inputPercent = () => {
    const val = parseFloat(display);
    setDisplay(String(val / 100));
    setPendingSecondEqual(false);
  };

  const performOperation = (nextOperator: string) => {
    const inputValue = parseFloat(display);

    if (prevValue == null) {
      setPrevValue(String(inputValue));
    } else if (operator) {
      const currentValue = parseFloat(prevValue);
      let newValue = currentValue;
      switch (operator) {
        case "+":
          newValue = currentValue + inputValue;
          break;
        case "-":
          newValue = currentValue - inputValue;
          break;
        case "×":
          newValue = currentValue * inputValue;
          break;
        case "÷":
          newValue = currentValue / inputValue;
          break;
      }
      setPrevValue(String(newValue));
      setDisplay(String(newValue));
    }
    setWaitingForOperand(true);
    setOperator(nextOperator);
    setPendingSecondEqual(false);
  };

  const handleEquals = () => {
    // Vault unlock logic: display == vault code && press "=="
    if (isVaultCode(display)) {
      if (pendingSecondEqual) {
        // second = : unlock
        if (equalTimeoutRef.current) window.clearTimeout(equalTimeoutRef.current);
        setPendingSecondEqual(false);
        unlockVault();
        router.push("/login");
        return;
      } else {
        // first = : wait for second
        setPendingSecondEqual(true);
        // auto reset after 1.5s
        if (equalTimeoutRef.current) window.clearTimeout(equalTimeoutRef.current);
        equalTimeoutRef.current = window.setTimeout(() => {
          setPendingSecondEqual(false);
          // normal equals behavior not needed for vault code, just keep display
        }, 1500);
        return;
      }
    }

    // normal calculator equals
    setPendingSecondEqual(false);
    if (equalTimeoutRef.current) window.clearTimeout(equalTimeoutRef.current);
    if (operator && prevValue != null) {
      performOperation("=");
      setOperator(null);
      setPrevValue(null);
      setWaitingForOperand(true);
    }
  };

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
    if (isNaN(n)) return display;
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
