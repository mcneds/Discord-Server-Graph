import type { DerivedGraphResult } from "../../domain/types";
import { getServerDisplayName } from "../../domain/display";
import { getCachedServerTableRows } from "../../domain/viewCache";
import { useGraphStore } from "../../state/useGraphStore";

type ServerTableViewProps = {
  data: DerivedGraphResult;
};

export const ServerTableView = ({ data }: ServerTableViewProps) => {
  const searchTerm = useGraphStore((state) => state.searchTerm);
  const selectServer = useGraphStore((state) => state.selectServer);

  const rows = getCachedServerTableRows(data, searchTerm);

  return (
    <section className="panel">
      <h2>Server Connectivity Table</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Server</th>
              <th>Collected Users</th>
              <th>Connected Servers</th>
              <th>Strongest Connected Server</th>
              <th>Strongest Edge</th>
              <th>Average Overlap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.node.id} onClick={() => selectServer(row.node.id)}>
                <td>
                  <div className="table-primary">{getServerDisplayName(row.node.name, true)}</div>
                  <div className="table-secondary">{row.node.id}</div>
                </td>
                <td>{row.node.collectedUserCount.toLocaleString()}</td>
                <td>{row.node.connectedServerCount.toLocaleString()}</td>
                <td>{row.strongestName}</td>
                <td>{row.strongestWeight.toLocaleString()}</td>
                <td>{row.averageOverlap.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
