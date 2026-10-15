import { app } from './app';
import { config } from './config';
app.listen(config.port, () => console.log(`T.A.S.K. API listening on :${config.port}`));
