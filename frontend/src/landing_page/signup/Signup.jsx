import { useState } from "react";
import { apiRequest, storeSession } from "../../api";

function Signup() {
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
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
      const session = await apiRequest(
        mode === "signup" ? "/signup" : "/login",
        {
          method: "POST",
          body: JSON.stringify(form),
        },
      );
      storeSession(session);
      window.location.replace("/dashboard");
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
            {mode === "signup" && (
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
            <label>
              <span className="form-label">Email</span>
              <input
                className="form-control"
                type="email"
                name="email"
                value={form.email}
                onChange={updateField}
                required
              />
            </label>
            <label>
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
            </label>
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
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <button
            className="btn btn-link px-0 mt-3"
            type="button"
            onClick={() => {
              setMode((current) => (current === "signup" ? "login" : "signup"));
              setError("");
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Need an account? Sign up"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default Signup;
