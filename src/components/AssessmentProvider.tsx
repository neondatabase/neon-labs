"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { AssessmentResult } from "@/lib/types";

interface AssessmentContextValue {
  assessment: AssessmentResult | null;
  setAssessment: (result: AssessmentResult | null) => void;
  clearAssessment: () => void;
}

const AssessmentContext = createContext<AssessmentContextValue | null>(null);

export function AssessmentProvider({ children }: { children: ReactNode }) {
  const [assessment, setAssessmentState] = useState<AssessmentResult | null>(
    null,
  );

  const setAssessment = useCallback((result: AssessmentResult | null) => {
    setAssessmentState(result);
  }, []);

  const clearAssessment = useCallback(() => {
    setAssessmentState(null);
  }, []);

  return (
    <AssessmentContext.Provider
      value={{
        assessment,
        setAssessment,
        clearAssessment,
      }}
    >
      {children}
    </AssessmentContext.Provider>
  );
}

export function useAssessment() {
  const ctx = useContext(AssessmentContext);
  if (!ctx) {
    throw new Error("useAssessment must be used within AssessmentProvider");
  }
  return ctx;
}
