import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import ValuationBridge from './components/ValuationBridge'

function FilingLensHome() {
  return <><Home /><ValuationBridge /></>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FilingLensHome />} />
    </Routes>
  )
}
