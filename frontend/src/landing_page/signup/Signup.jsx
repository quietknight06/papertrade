import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { apiRequest } from "../../api";

function Signup() {
  const auth = useAuth();
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [confirmationCode, setConfirmationCode] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const updateField = (event) => {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (awaitingConfirmation) {
        await auth.confirmSignUp(form.email, confirmationCode);
        setAwaitingConfirmation(false);
        setMode("login");
        setError("Email confirmed. Sign in to continue.");
      } else if (mode === "signup") {
        const result = await auth.signUp(form);
        if (result.isSignUpComplete) {
          setMode("login");
        } else {
          setAwaitingConfirmation(true);
        }
      } else {
        const result = await auth.signIn(form.email, form.password);
        if (!result.isSignedIn) throw new Error(`Additional sign-in step required: ${result.nextStep?.signInStep || "unknown"}`);
        await apiRequest("/profile", {
          method: "POST",
          body: JSON.stringify({
            name: result.user?.name || form.name || form.email.split("@")[0],
            email: result.user?.email || form.email,
          }),
        });
        window.location.replace("/dashboard");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container py-5">
      <div className="row align-items-center g-5 py-5">
        <div className="col-lg-6">
          <img
            className="img-fluid"
            src="/media/images/signup.png"
            alt="PaperTrade account signup"
          />
        </div>
        <div className="col-lg-6 text-start">
          <h1>
            {mode === "signup"
              ? "Open a free paper-trading account"
              : "Welcome back"}
          </h1>
          <p className="lead mb-4">
            Use live quotes, simulated funds and orders, portfolio tracking, and
            clearly labelled experimental forecasts. No real trading occurs.
          </p>
          <form
            onSubmit={submit}
            className="d-grid gap-3"
            aria-label={mode === "signup" ? "Create account" : "Sign in"}
          >
            {mode === "signup" && !awaitingConfirmation && (
              <label>
                <span className="form-label">Full name</span>
                <input
                  className="form-control"
                  name="name"
                  value={form.name}
                  onChange={updateField}
                  minLength="2"
                  required
                />
              </label>
            )}
            {!awaitingConfirmation && <label>
              <span className="form-label">Email</span>
              <input
                className="form-control"
                type="email"
                name="email"
                value={form.email}
                onChange={updateField}
                required
              />
            </label>}
            {!awaitingConfirmation && <label>
              <span className="form-label">Password</span>
              <input
                className="form-control"
                type="password"
                name="password"
                value={form.password}
                onChange={updateField}
                minLength="8"
                required
              />
            </label>}
            {awaitingConfirmation && (
              <label>
                <span className="form-label">Email confirmation code</span>
                <input
                  className="form-control"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={confirmationCode}
                  onChange={(event) => setConfirmationCode(event.target.value)}
                  required
                />
              </label>
            )}
            {error && (
              <div className="alert alert-danger mb-0" role="alert">
                {error}
              </div>
            )}
            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Please wait…"
                : awaitingConfirmation
                  ? "Confirm email"
                  : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <button
            className="btn btn-link px-0 mt-3"
            type="button"
            disabled={awaitingConfirmation}
            onClick={() => {
              setMode((current) => (current === "signup" ? "login" : "signup"));
              setError("");
            }}
          >
            {awaitingConfirmation
              ? "Check your email for a confirmation code"
              : mode === "signup"
              ? "Already have an account? Sign in"
              : "Need an account? Sign up"}
          </button>
          <div className="mt-3 pt-3 border-top">
            <p className="mb-2 text-muted">
              Want to explore first? Demo trades and funds last only for this
              browser tab.
            </p>
            <Link className="btn btn-outline-primary" to="/demo">
              Try dashboard demo
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default Signup;
