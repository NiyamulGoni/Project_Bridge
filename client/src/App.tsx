import { Route, Routes } from 'react-router';
import { NavBar } from './components/NavBar';
import { RequireAuth } from './components/RequireAuth';
import { Account } from './pages/Account';
import { AdminArea } from './pages/AdminArea';
import { Explore } from './pages/Explore';
import { ForgotPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
import { MyProjects } from './pages/MyProjects';
import { NotFound } from './pages/NotFound';
import { Notifications } from './pages/Notifications';
import { ProjectEditor } from './pages/ProjectEditor';
import { ProjectManage } from './pages/ProjectManage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectPreview } from './pages/ProjectPreview';
import { Register } from './pages/Register';
import { Requests } from './pages/Requests';
import { ResetPassword } from './pages/ResetPassword';

export function App() {
  return (
    <>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <NavBar />
      <div id="content">
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/account"
            element={
              <RequireAuth>
                <Account />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <Notifications />
              </RequireAuth>
            }
          />
          <Route
            path="/requests"
            element={
              <RequireAuth>
                <Requests />
              </RequireAuth>
            }
          />
          <Route
            path="/my-projects"
            element={
              <RequireAuth>
                <MyProjects />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/new"
            element={
              <RequireAuth>
                <ProjectEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:id/edit"
            element={
              <RequireAuth>
                <ProjectEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:id/preview"
            element={
              <RequireAuth>
                <ProjectPreview />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:id/manage"
            element={
              <RequireAuth>
                <ProjectManage />
              </RequireAuth>
            }
          />
          <Route path="/projects/:id" element={<ProjectPage />} />
          {/* Not guarded in the UI on purpose: the server decides (see AdminArea). */}
          <Route path="/admin" element={<AdminArea />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </>
  );
}
