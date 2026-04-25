# Phân tích kiến trúc Database — Deep Dive

## 1. Query cột numeric không có index: ClickHouse vs PostgreSQL/MySQL

### Ví dụ query

```sql
SELECT SUM(volume) FROM trades WHERE volume > 1000;
-- cột `volume` không có index
```

---

### PostgreSQL / MySQL — Row-oriented: Thảm họa I/O

**Cơ chế vật lý:**

Dữ liệu lưu theo **hàng (row)**. Một block disk chứa tất cả các cột của N dòng liền kề:

```
Block trên disk:
[ id=1 | symbol="BTC" | volume=500  | price=60000 | created_at=... ]
[ id=2 | symbol="ETH" | volume=1500 | price=3000  | created_at=... ]
[ id=3 | symbol="BNB" | volume=200  | price=400   | created_at=... ]
...
```

**Sequential Scan khi không có index:**

1. Engine đọc **từng block** từ disk lên RAM
2. Với mỗi dòng, trích xuất `volume` — nhưng đã phải kéo cả `id`, `symbol`, `price`, `created_at` lên RAM theo
3. Kiểm tra `volume > 1000`, cộng vào `SUM`
4. Lặp đến hết bảng

**Hậu quả:**

| Vấn đề | Chi tiết |
|--------|---------|
| I/O phình to | Đọc 10 cột chỉ để dùng 1 — lãng phí 90% băng thông disk |
| Cache pollution | Dữ liệu các cột không dùng lấp đầy Buffer Pool, đẩy trang hữu ích ra ngoài |
| Đơn luồng | Mặc định xử lý tuần tự, không tận dụng multi-core |
| Kết quả | 100M dòng → vài phút đến timeout |

---

### ClickHouse — Column-oriented: Brute-force có kiểm soát

**Cơ chế vật lý:**

Mỗi cột nằm trong file riêng biệt trên disk:

```
volume.bin:    [ 500, 1500, 200, 3000, 800, ... ]   ← chỉ đọc file này
symbol.bin:    [ "BTC", "ETH", "BNB", ... ]          ← bỏ qua hoàn toàn
price.bin:     [ 60000, 3000, 400, ... ]              ← bỏ qua hoàn toàn
```

**Quá trình xử lý:**

1. Chỉ đọc **duy nhất** `volume.bin` — bỏ qua hoàn toàn tất cả cột khác
2. Numeric cùng kiểu lưu liền nhau → nén cực tốt (thường 5–10×), disk I/O thực tế rất nhỏ
3. Nạp mảng giá trị vào CPU cache, dùng **SIMD** để filter và tính SUM song song hàng nghìn phần tử mỗi chu kỳ
4. **Tự động song song hóa** trên tất cả CPU core

**Benchmark thực tế:**

| Database | 1 tỷ dòng — `SUM(volume) WHERE volume > X` | RAM cần thiết |
|----------|-------------------------------------------|--------------|
| PostgreSQL | 5–30 phút (sequential scan) | Toàn bộ bảng qua buffer |
| MySQL | Tương tự PostgreSQL | Tương tự |
| ClickHouse | **1–5 giây** | Chỉ cột `volume` |

> **Điểm mấu chốt:** Không có index trên cột numeric không phải vấn đề với ClickHouse — columnar storage + vectorized execution chính là "index tự nhiên" cho aggregate scan.

---

## 2. Khi nào chọn ClickHouse thay vì DB khác?

### Ma trận so sánh

| Tiêu chí | ClickHouse | Cassandra / ScyllaDB | PostgreSQL / TimescaleDB |
|---------|-----------|----------------------|--------------------------|
| **Workload chính** | OLAP — analytics, aggregation | OLTP — high-throughput point read/write | OLTP + time-series vừa phải |
| **Mô hình lưu trữ** | Columnar | Wide-column (row-based per partition) | Row-based |
| **Scale ngang** | Shard thủ công / Keeper | Native — gần như vô hạn | Giới hạn, cần extension |
| **Aggregate query** | ⭐⭐⭐⭐⭐ cực nhanh | ❌ không làm được | ⭐⭐⭐ ổn, chậm khi TB+ |
| **Point read/write** | ⭐⭐ được, không phải thế mạnh | ⭐⭐⭐⭐⭐ mili-giây | ⭐⭐⭐⭐ tốt |
| **ACID transaction** | ❌ không | ❌ không (eventual consistency) | ✅ đầy đủ |
| **JOIN phức tạp** | ⭐⭐ hỗ trợ nhưng hạn chế | ❌ không | ⭐⭐⭐⭐⭐ |
| **Update / Delete** | Rất đắt (mutations) | Rất đắt (tombstones) | Bình thường |
| **Kích thước data** | TB → PB | TB → PB | GB → vài TB |

---

### ClickHouse vs Cassandra / ScyllaDB

**Cassandra / ScyllaDB sinh ra cho:**
- Write-heavy: hàng triệu event/giây
- Multi-datacenter active-active replication
- Point lookup bằng Partition Key: `SELECT * FROM trades WHERE user_id = ?`
- High availability tuyệt đối, không single point of failure

**Cassandra KHÔNG làm được:**

```sql
-- Query này sẽ timeout hoặc fail trên Cassandra
SELECT symbol, SUM(volume), AVG(price)
FROM trades
WHERE timestamp > now() - INTERVAL '7 days'
GROUP BY symbol
ORDER BY SUM(volume) DESC;
```

Muốn analytics trên Cassandra phải kéo data ra Spark/Flink xử lý bên ngoài.

**Chọn ClickHouse** khi cần dashboard, report, aggregation trên nhiều tháng dữ liệu.  
**Chọn Cassandra/ScyllaDB** khi cần ghi throughput cao, lookup theo key, multi-region.

---

### ClickHouse vs PostgreSQL / TimescaleDB

**TimescaleDB** là PostgreSQL gắn thêm extension time-series:
- Tự động chia data thành **chunks** theo thời gian → drop data cũ gần như tức thì
- Thêm **columnar compression** cho chunks cũ (tiết kiệm disk đáng kể)
- Giữ nguyên ACID, JOIN, toàn bộ ecosystem của Postgres

**Giới hạn của TimescaleDB ở scale lớn:**
- Vẫn là row-based engine ở lõi — aggregate scan qua nhiều tháng/năm chậm hơn ClickHouse
- Columnar compression chỉ áp dụng cho chunks đã nén (data cũ), data mới vẫn là row
- Khi TB+ với hàng chục query analytics đồng thời: ClickHouse thắng rõ ràng

**Chọn TimescaleDB** khi đã có stack Postgres, cần ACID + JOIN, data dưới ~2 TB.  
**Chọn ClickHouse** khi mục tiêu thuần là ingest nhanh + analytics dưới 1 giây ở scale lớn.

---

## 3. Ưu và nhược điểm chi tiết của từng Database

### ClickHouse

**Ưu điểm:**
- **Tốc độ aggregate cực cao** — scan tỷ dòng với SUM/AVG/GROUP BY trong vài giây nhờ columnar storage + SIMD vectorization
- **Nén dữ liệu xuất sắc** — numeric cùng kiểu nằm cạnh nhau, LZ4/ZSTD nén 5–10×, tiết kiệm disk và I/O đáng kể
- **Không cần index để query nhanh** — với analytics query, full column scan vẫn nhanh hơn row DB có index
- **Materialized Views tự động** — tính toán pre-aggregate incremental khi data insert, không cần job riêng
- **Sparse index tự động** — `ORDER BY` key tạo index thưa tự nhiên, skip granule không liên quan
- **Horizontal scale** — Distributed/ReplicatedMergeTree chia shard + replicate qua nhiều node
- **SQL quen thuộc** — cú pháp gần chuẩn ANSI SQL, learning curve thấp

**Nhược điểm:**
- **Không có transaction (ACID)** — không rollback, không isolation level
- **Update/Delete cực đắt** — dùng `ALTER TABLE ... UPDATE/DELETE` (mutations) chạy ngầm, không synchronous
- **Append-only tư duy** — thiết kế tốt nhất khi data chỉ insert, không sửa; mọi "sửa" đều là overhead
- **Dedup không tức thì** — `ReplacingMergeTree` dedup trong background merge, có thể mất giờ/ngày mới xong hoàn toàn
- **JOIN hạn chế** — left table phải fit vào RAM của node nhận query; large-large JOIN rất chậm
- **Point lookup chậm** — query 1 dòng theo ID ngẫu nhiên không phải thế mạnh
- **Khó debug khi schema sai** — một khi data insert sai schema, sửa lại tốn công (mutation hoặc drop+rebuild)

---

### PostgreSQL

**Ưu điểm:**
- **ACID đầy đủ** — transaction, rollback, isolation levels (Read Committed, Repeatable Read, Serializable)
- **JOIN mạnh** — Hash Join, Nested Loop, Merge Join; query planner tối ưu tốt
- **Ecosystem lớn nhất** — extensions (PostGIS, pg_vector, TimescaleDB, Citus), công cụ (pgAdmin, pgBadger, pg_stat_statements)
- **Flexible schema** — JSONB column cho semi-structured data, mảng, hstore
- **Vacuum + MVCC** — đọc không block ghi, ghi không block đọc nhờ Multi-Version Concurrency Control
- **Mature và đáng tin** — 35+ năm phát triển, corner case bugs gần như không còn
- **Point lookup nhanh** — B-Tree index + buffer pool cho single-row access trong micro-giây

**Nhược điểm:**
- **Row-based** — full table scan khi analytics: đọc toàn bộ row dù chỉ cần 1 cột
- **Vertical scale chủ yếu** — horizontal scale cần extension (Citus, Patroni) phức tạp
- **B-Tree suy giảm khi index > RAM** — random disk I/O giết throughput upsert ở large scale
- **VACUUM overhead** — dead tuples tích tụ từ MVCC phải được VACUUM dọn dẹp; bảng write-heavy cần autovacuum tune cẩn thận
- **Write amplification** — WAL + heap + index phải đồng thời update khi ghi
- **Không tốt cho time-series thuần** — partition thủ công, không auto-drop chunk cũ như TimescaleDB

---

### TimescaleDB (PostgreSQL + time-series extension)

**Ưu điểm:**
- **Chunk-based partitioning tự động** — chia data theo thời gian, drop chunk cũ = drop file → tức thì, không scan
- **Columnar compression cho chunk cũ** — chunk đã đóng được nén theo column, tiết kiệm 90%+ disk
- **Continuous Aggregates** — materialized view tự refresh incremental theo thời gian, query nhanh trên pre-aggregate
- **Data retention policy** — `add_retention_policy(interval => '90 days')` tự xóa data cũ
- **Giữ nguyên Postgres** — toàn bộ ACID, JOIN, extension, tooling vẫn hoạt động
- **Hyperfunctions** — `time_bucket`, `first`, `last`, `histogram` — query time-series tự nhiên hơn

**Nhược điểm:**
- **Vẫn row-based cho data mới** — chunk đang ghi chưa được compress, query trên data mới vẫn là row scan
- **Chậm hơn ClickHouse ở scale lớn** — khi TB+ và nhiều query analytics đồng thời, overhead Postgres planner + row format thua rõ
- **Extension dependency** — TimescaleDB version phải match PostgreSQL version; upgrade phức tạp hơn vanilla Postgres
- **Continuous Aggregates có độ trễ** — refresh có lag, không realtime hoàn toàn
- **Scale ngang phức tạp** — multi-node TimescaleDB cần license Enterprise hoặc Citus kết hợp

---

### Cassandra / ScyllaDB

**Ưu điểm:**
- **Throughput ghi vô địch** — MemTable ghi vào RAM ngay lập tức, không đọc disk; hàng triệu write/giây
- **Horizontal scale tuyến tính** — thêm node = thêm capacity, không có single master bottleneck
- **Multi-datacenter active-active** — ghi đồng thời ở nhiều DC, automatic replication
- **Tunable consistency** — chọn `QUORUM`, `ONE`, `LOCAL_QUORUM` per query tùy trade-off latency vs consistency
- **LWW dedup tự nhiên** — upsert không cần check read, duplicate tự triệt tiêu qua compaction
- **Không single point of failure** — mọi node đều như nhau (peer-to-peer), một node chết cluster vẫn hoạt động
- **ScyllaDB** — rewrite của Cassandra bằng C++, latency thấp hơn và CPU hiệu quả hơn đáng kể

**Nhược điểm:**
- **Không có analytics** — GROUP BY, SUM, aggregate scan trên toàn bảng: không làm được hoặc cực chậm
- **Không có JOIN** — data model phải denormalize hoàn toàn, thường cần nhiều bảng cho cùng data
- **Tombstone amplification** — DELETE không xóa ngay mà để lại tombstone; quá nhiều tombstone làm read chậm và tốn memory
- **Schema design cứng** — phải biết query pattern trước khi thiết kế bảng; thay đổi query pattern thường = thiết kế lại schema
- **Eventual consistency** — dữ liệu có thể stale nếu đọc với consistency thấp
- **Không có transaction** — LWT (Lightweight Transaction) có ACID một phần nhưng cực chậm (Paxos round-trip)
- **Compaction overhead** — background merge tiêu tốn CPU/disk I/O, ảnh hưởng latency trong giờ cao điểm

---

### MySQL

**Ưu điểm:**
- **Đơn giản và phổ biến** — learning curve thấp nhất, tài liệu nhiều nhất, DBA biết nhiều nhất
- **InnoDB ACID** — transaction, foreign key, row-level locking
- **Replication dễ** — master-slave, GTID-based replication dễ cài đặt
- **Nhẹ tài nguyên** — chạy được trên máy yếu, phù hợp ứng dụng nhỏ
- **Ecosystem web** — PHP/Laravel, WordPress, Drupal — tích hợp tốt

**Nhược điểm:**
- **Row-based hoàn toàn** — full table scan tệ như PostgreSQL, không có columnar option
- **Query planner yếu hơn Postgres** — thường chọn execution plan không tối ưu với query phức tạp
- **JSON/semi-structured yếu** — JSON support thua PostgreSQL JSONB nhiều
- **Horizontal scale khó** — sharding thủ công hoặc dùng Vitess (phức tạp)
- **Oracle sở hữu** — licensing và roadmap không cộng đồng driven như PostgreSQL
- **Không có extension system** — không thể thêm tính năng như Postgres extension

---

### Bảng tóm tắt ưu nhược điểm

| Database | Tốt nhất cho | Không nên dùng khi |
|----------|-------------|-------------------|
| **ClickHouse** | Analytics, aggregate query, time-series lớn | Cần transaction, update thường xuyên, point lookup |
| **PostgreSQL** | OLTP tổng hợp, JOIN phức tạp, ACID bắt buộc | Data TB+ analytics thuần, write throughput cực cao |
| **TimescaleDB** | Time-series + vẫn cần SQL/JOIN, data vài trăm GB–2TB | Scale lớn hơn, team không có Postgres kinh nghiệm |
| **Cassandra/ScyllaDB** | Write-heavy, multi-region, high availability tuyệt đối | Cần analytics, JOIN, transaction |
| **MySQL** | Web app nhỏ-vừa, đội ngũ quen MySQL | Analytics, scale lớn, query phức tạp |

---

## 4. Deduplication — Điểm khác biệt cốt lõi

### Cassandra / ScyllaDB — Dedup on Write (Last Write Wins)

**Cơ chế:**

Cassandra không phân biệt `INSERT` và `UPDATE` — chỉ có **UPSERT**:

```
Write path:
  1. Nhận record mới → ghi vào MemTable (RAM) kèm timestamp
  2. Flush xuống SSTable (disk) khi MemTable đầy
  3. Compaction ngầm: merge SSTables → key trùng → giữ timestamp mới nhất (LWW)
```

**Tại sao cực tốt cho dedup:**
- Không đọc disk để kiểm tra trùng → **write không bao giờ bị block bởi read**
- Throughput ghi thuần: hàng triệu ops/giây
- Duplicate tự triệt tiêu qua Compaction, không cần application logic

```python
# Cassandra: ghi bất kể trùng — hệ thống tự xử lý
session.execute(
    "INSERT INTO trades (id, volume, price) VALUES (?, ?, ?)",
    [trade_id, volume, price]
)
# Nếu trade_id đã tồn tại → tự động overwrite bằng LWW
```

---

### PostgreSQL — B-Tree Dedup: tốt khi Medium, sập khi Large

**Cơ chế:**

```sql
INSERT INTO trades (id, volume, price)
VALUES (1, 500, 60000)
ON CONFLICT (id) DO UPDATE SET volume = EXCLUDED.volume;
```

**Quá trình vật lý:**

1. Postgres tra B-Tree index trên cột `id` để tìm record trùng
2. **B-Tree nằm trong RAM?** → Lookup trong memory, disk I/O gần như 0
3. **B-Tree lớn hơn RAM?** → Phải đọc page B-Tree từ disk

**Tại sao sập khi DB lớn:**

```
DB medium (index < RAM):
  INSERT → tra B-Tree trong RAM → check → ghi → xong
  Disk I/O: gần như 0 cho phase check

DB large (index >> RAM):
  INSERT với ID ngẫu nhiên → tra B-Tree → page cần không có trong RAM
  → đọc random page từ disk (Random I/O, ~100× chậm hơn Sequential I/O)
  → throughput insert giảm từ ~100k/s xuống vài nghìn/s
```

**Điểm gãy thực tế:** Khi B-Tree index vượt ~50–70% RAM available, hiệu năng upsert suy giảm rõ rệt do random disk I/O.

---

### ClickHouse — Eventual Dedup (ReplacingMergeTree)

**Cơ chế:**

ClickHouse là **append-only** engine — không thể check trùng lúc ghi (không có read trong write path).

```sql
CREATE TABLE trades (
    id       String,
    volume   Float64,
    price    Float64,
    version  UInt64   -- thường dùng Unix timestamp
) ENGINE = ReplacingMergeTree(version)
ORDER BY id;
```

**Write path:**

```
INSERT → ghi ngay vào Part mới (không check trùng)
Background: ClickHouse định kỳ merge các Parts → lúc merge mới xóa duplicate (giữ version cao nhất)
```

**Vấn đề:**

```sql
-- Query ngay sau INSERT có thể thấy duplicate vì merge chưa chạy
SELECT * FROM trades;  -- id=1 có thể xuất hiện 2 lần

-- Giải pháp 1: FINAL (chậm — force dedup tại query time)
SELECT * FROM trades FINAL;

-- Giải pháp 2: dùng aggregation thay vì scan raw
SELECT id, argMax(volume, version), argMax(price, version)
FROM trades
GROUP BY id;
```

**Trade-off:**

| Cách dùng | Tốc độ ghi | Tốc độ đọc | Độ chính xác |
|-----------|-----------|-----------|-------------|
| `FINAL` keyword | ⭐⭐⭐⭐⭐ | ⭐⭐ chậm | ✅ chính xác |
| `argMax` aggregate | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ chính xác |
| Không dedup | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ có duplicate |

---

### Bảng quyết định Dedup

| Yêu cầu | Phù hợp nhất | Lý do |
|---------|-------------|-------|
| Dedup ngay lập tức, chính xác, ghi nhanh | **Cassandra / ScyllaDB** | LWW upsert không cần read |
| Dedup chính xác + ACID + data medium | **PostgreSQL** | B-Tree index nằm trong RAM |
| Dedup chính xác + data lớn + transaction | **PostgreSQL + partitioning / TimescaleDB** | Chunk-based giữ index nhỏ hơn |
| Eventual dedup OK, analytics là ưu tiên | **ClickHouse ReplacingMergeTree** | Background merge + `FINAL`/`argMax` khi cần |
| PostgreSQL B-Tree bị random I/O | Migrate sang **ClickHouse** hoặc **Cassandra** | Index vượt RAM → random disk I/O giết throughput |

---

## 5. Redis Streams vs Apache Kafka

Cả hai đều là message broker cho streaming pipeline, nhưng được xây dựng trên kiến trúc hoàn toàn khác nhau với trade-off vận hành rất khác nhau.

---

### Tổng quan kiến trúc

**Redis Streams**

Redis Streams là cấu trúc dữ liệu dạng append-only log được tích hợp **bên trong Redis** (một in-memory data store). Message mặc định sống trong RAM; persistence là best-effort qua RDB/AOF snapshot.

```
Producer → XADD mystream * field value
Consumer → XREAD COUNT 100 STREAMS mystream 0
           XREADGROUP GROUP workers consumer1 COUNT 100 STREAMS mystream >
```

Các khái niệm chính:
- **Stream** = append-only log được đặt tên, lưu trong Redis key
- **Consumer Group** = theo dõi message nào consumer đã xử lý (giống Kafka consumer group)
- **Message ID** = `<millisecondTimestamp>-<sequenceNumber>` — đảm bảo thứ tự tự nhiên

**Apache Kafka**

Kafka là **hệ thống distributed log chuyên dụng** được xây dựng từ đầu cho durable, high-throughput, fault-tolerant event streaming. Message ghi xuống disk trong các log segment bất biến, append-only.

```
Producer → KafkaProducer.send(topic, key, value)
Consumer → KafkaConsumer.poll() với committed offset per partition
```

Các khái niệm chính:
- **Topic** = log được đặt tên, chia thành N **Partition**
- **Partition** = log append-only, bất biến, có thứ tự trên disk
- **Offset** = vị trí của message trong partition — consumer tự track offset của mình
- **Consumer Group** = mỗi partition được gán cho đúng 1 consumer trong group

---

### So sánh chi tiết

| Tiêu chí | Redis Streams | Apache Kafka |
|---------|--------------|-------------|
| **Lưu trữ chính** | In-memory (disk tùy chọn qua AOF/RDB) | Disk-first (luôn persistent) |
| **Throughput** | ~500k–1M msg/s (message nhỏ, single node) | ~1–10M+ msg/s (với partitioning) |
| **Latency** | Sub-millisecond (memory) | 1–10ms (disk fsync + network) |
| **Độ bền** | Best-effort — mất data khi crash nếu không có AOF | Đảm bảo — sống sót qua restart broker |
| **Retention** | Giới hạn bởi RAM + `MAXLEN` trim | Ngày, tuần, hoặc vô hạn (giới hạn bởi disk) |
| **Replay** | Có, qua consumer group offset hoặc message ID | Có, qua partition offset |
| **Ordering** | Global per stream | Per partition only |
| **Scale ngang** | Giới hạn — Redis Cluster shard theo key, không native cho stream | Native — thêm partition và broker |
| **Consumer groups** | Built-in (XREADGROUP) | Built-in (tính năng cốt lõi) |
| **Độ phức tạp ops** | Thấp — đã có trong stack Redis rồi | Cao — ZooKeeper/KRaft, Kafka cluster, monitoring |
| **Chi phí** | Rẻ nếu Redis đã được deploy | Cluster riêng: VMs + storage + ops time |
| **Ecosystem** | Tối giản | Phong phú — Kafka Connect, Kafka Streams, ksqlDB, Schema Registry |

---

### Redis Streams — Điểm đặc biệt

**Ưu điểm nổi bật:**

1. **Zero infrastructure bổ sung** — đã chạy Redis rồi là có message broker miễn phí
2. **Latency sub-millisecond** — data nằm trong RAM, không có disk flush trong hot path
3. **Mô hình vận hành đơn giản** — một tool, một config, một monitoring surface
4. **Tự động trim** — `XADD mystream MAXLEN ~ 100000 * ...` giữ memory bounded không cần cron job riêng
5. **Tích hợp chặt với Redis data structures** — có thể atomically đọc stream và cập nhật hash/sorted-set trong một `MULTI/EXEC` block

**Lý tưởng cho:**
- Pipeline throughput thấp đến trung bình (vài trăm nghìn msg/s trở xuống)
- Đường dữ liệu nhạy cảm với latency, yêu cầu sub-ms
- Project đã dùng Redis và muốn tránh thêm broker thứ hai
- Event ngắn hạn, không cần replay quá vài giờ

**Điểm yếu:**
- RAM đắt — backlog lớn tốn memory, không phải disk rẻ
- Không có partition-level parallelism: một stream là một log duy nhất; scale phải tự chia stream trong application code
- Độ bền yếu hơn — `AOF fsync=always` bù đắp được nhưng tăng latency; `fsync=everysec` có thể mất ~1 giây data khi crash
- Không có schema registry, không có connector ecosystem

---

### Apache Kafka — Điểm đặc biệt

**Ưu điểm nổi bật:**

1. **Durability disk-based** — data sống sót qua crash, broker restart, và rolling upgrade
2. **Retention vô hạn** — lưu event 30 ngày hoặc mãi mãi; consumer mới có thể replay toàn bộ lịch sử
3. **Partition-level parallelism** — 100 partition = 100 consumer đọc đồng thời không cần coordinate
4. **Exactly-once semantics** — idempotent producer + transactional consumer đảm bảo không duplicate, không mất data
5. **Ecosystem phong phú** — Kafka Connect (100+ connector), Kafka Streams (stateful processing), ksqlDB (SQL trên stream), Schema Registry (Avro/Protobuf)
6. **Replayability** — service mới có thể consume toàn bộ event history từ offset 0

**Lý tưởng cho:**
- Pipeline throughput cao: hàng triệu event/giây
- Event sourcing hoặc audit log phải bền và replayable
- Fan-out: một topic được consume bởi nhiều service độc lập
- Pipeline yêu cầu exactly-once delivery là bắt buộc
- Retention dài hạn (compliance, training ML model)

**Điểm yếu:**
- **Phức tạp khi vận hành** — quản lý Kafka cluster (broker, replication factor, partition count, consumer lag monitoring) là công việc full-time
- **Latency floor cao hơn** — disk fsync tốn mili-giây; không phù hợp yêu cầu sub-ms
- **Over-engineered cho workload nhỏ** — dựng 3-broker Kafka cluster cho 10k msg/s là lãng phí
- **Chi phí** — VMs riêng + EBS/SSD storage + ops tooling cộng lại đáng kể

---

### NATS / NATS JetStream — Điểm đặc biệt

**NATS là gì:**

NATS là message broker **siêu nhẹ** viết bằng Go, thiết kế cho độ trễ cực thấp và simplicity. Có hai chế độ hoàn toàn khác nhau:

```
NATS Core (publish-subscribe thuần):
  Publisher → Subject "trades.BTC" → Subscriber nhận ngay
  Fire-and-forget: không lưu, không replay, subscriber offline = mất message

NATS JetStream (persistent streaming):
  Publisher → Stream "TRADES" → Consumer group → ACK → lưu trên disk
  Có replay, có consumer group, có at-least-once delivery
```

**Kiến trúc vật lý:**
- Server NATS là một binary Go ~20MB, không dependency
- Cluster: 3–5 node, dùng Raft consensus (tự bầu leader, không cần ZooKeeper)
- JetStream lưu message vào file trên disk theo subject + stream name
- Mỗi message có sequence number, consumer track offset riêng

**So sánh NATS JetStream vs Redis Streams vs Kafka:**

| Tiêu chí | NATS JetStream | Redis Streams | Apache Kafka |
|---------|---------------|--------------|-------------|
| **Latency** | < 1ms (gần bằng Redis) | Sub-ms | 1–10ms |
| **Throughput** | ~3–10M msg/s | ~500k–1M msg/s | ~1–10M+ msg/s |
| **Durability** | Disk-based (Raft) | Best-effort (AOF) | Disk-based (ISR) |
| **Ops complexity** | Rất thấp — single binary | Thấp | Cao (ZooKeeper/KRaft) |
| **Horizontal scale** | Tốt (Raft cluster) | Giới hạn | Native — tốt nhất |
| **Replay** | Có (sequence offset) | Có (message ID) | Có (partition offset) |
| **Ordering** | Per subject | Per stream | Per partition |
| **Exactly-once** | Không | Không | Có (transactional) |
| **Ecosystem** | Nhỏ nhưng đang lớn | Minimal | Lớn nhất |
| **Wildcard subscription** | ⭐⭐⭐⭐⭐ cực mạnh | ❌ không | ❌ không |
| **Request-Reply** | Native built-in | Không | Không |
| **Binary size** | ~20MB | Phụ thuộc Redis | ~100MB+ |

---

**NATS — Ưu điểm nổi bật:**

1. **Wildcard routing cực mạnh** — subscribe `trades.>` nhận tất cả subject bắt đầu bằng `trades.`; `trades.*` nhận một level; không DB nào khác có pattern matching native như vậy
2. **Request-Reply built-in** — client gửi request, chờ reply; xây microservice sync/async rất tự nhiên
3. **Ops cực đơn giản** — một binary, không dependency, cluster tự bầu leader qua Raft; khởi động trong giây
4. **Latency thấp gần Redis** — message đi qua memory trước khi flush disk (JetStream), latency < 1ms
5. **Multi-tenancy** — Account isolation native; nhiều team dùng chung một NATS cluster an toàn
6. **Leaf Node** — node nhỏ ở edge/remote kết nối về NATS cluster trung tâm, transparent bridging

**NATS — Nhược điểm:**

- **Ecosystem nhỏ hơn Kafka nhiều** — không có connector ecosystem, không ksqlDB, không Schema Registry
- **Không exactly-once** — JetStream chỉ at-least-once; dedup phải xử lý ở application hoặc database
- **Partition-level scale yếu hơn Kafka** — Kafka partition model linh hoạt hơn cho scale cực lớn
- **NATS Core mất message khi subscriber offline** — nếu không dùng JetStream, không có buffer
- **Ít battle-tested ở hyperscale** — Kafka có track record ở Netflix/LinkedIn/Uber; NATS JetStream còn trẻ hơn
- **Monitoring ecosystem nhỏ** — không có dashboards phong phú như Kafka (Confluent UI, Cruise Control)

**NATS phù hợp nhất khi:**
- Microservice cần cả pub-sub lẫn request-reply trên cùng broker
- Cần ops đơn giản hơn Kafka nhưng Kafka-like durability (JetStream)
- IoT / edge computing: node nhỏ chạy ở edge, leaf node kết nối về center
- Latency < 1ms là yêu cầu nhưng Redis Streams không đủ durability
- Pattern matching subject phức tạp: `sensor.region1.device42.temperature`

---

### Cây quyết định: Redis Streams vs Kafka vs NATS

```
Cần exactly-once delivery (bắt buộc, không thỏa hiệp)?
  └─ Có → Kafka (transactional producer, duy nhất trong 3 cái có tính năng này)

Volume > 10M msg/s hoặc cần partition-level scale cực lớn?
  └─ Có → Kafka

Nhiều consumer độc lập cần replay toàn bộ lịch sử (audit log, ML training)?
  └─ Có → Kafka (long-term retention, offset 0 replayable)

Cần request-reply + pub-sub + wildcard routing trên cùng broker?
  └─ Có → NATS (native request-reply, subject pattern: `sensor.*.temp`)

Cần Kafka-like durability nhưng ops đơn giản hơn nhiều, không cần exactly-once?
  └─ Có → NATS JetStream (single binary, Raft cluster, < 1ms latency)

IoT / edge / microservice nhiều subject phức tạp?
  └─ Có → NATS (leaf node, wildcard `trades.>`, multi-tenancy)

Đã chạy Redis + backlog nhỏ + latency nhạy cảm + không cần broker riêng?
  └─ Có → Redis Streams (zero infra, sub-ms, tích hợp MULTI/EXEC với Redis)

Stack đơn giản, team nhỏ, moderate scale, cần durability rõ ràng?
  └─ NATS JetStream

Stack đơn giản, team nhỏ, Redis đã có, replay không quan trọng?
  └─ Redis Streams
```

---

### Tại sao fullstackAI dùng Redis Streams thay vì Kafka

Project ingest Binance trade event và đẩy vào ClickHouse để analytics:

| Yếu tố | Đánh giá Redis Streams |
|--------|----------------------|
| Đã có trong stack | ✅ Redis đã dùng cho caching và rate-limiting rồi |
| Khối lượng message | Binance WebSocket: ~5–50k msg/s per symbol — nằm trong tầm Redis Streams |
| Latency | Sub-ms từ Binance consumer đến ClickHouse writer giúp biểu đồ real-time mượt |
| Yêu cầu retention | Event đã persist trong ClickHouse; stream chỉ là transit buffer, không phải source of truth |
| Replay | ClickHouse là replay source; broker replay không cần thiết |
| Chi phí vận hành | Dựng 3-node Kafka cluster cho scale này là overhead không cần thiết |

**Kafka sẽ là lựa chọn đúng** nếu: cần fan-out trade event cho 5+ service độc lập, yêu cầu exactly-once ở tầng broker, hoặc cần retention trong broker (không phải ClickHouse) cho mục đích compliance.

---

## 6. Tổng kết stack fullstackAI

| Tầng | Lựa chọn | Lý do |
|------|---------|-------|
| **Nguồn dữ liệu** | Binance WebSocket | Real-time trade events |
| **Message broker** | Redis Streams | Đã có trong stack, sub-ms latency, throughput đủ dùng |
| **Analytics store** | ClickHouse | Columnar scan, query numeric không index vẫn nhanh, scale TB |
| **Xử lý** | Pandas (batch) / Go Fiber (API) | Nhẹ, không cần overhead Spark/Flink |
| **Frontend** | React | Dashboard UI chuẩn |

**Đã loại:** Kafka (over-engineered cho scale này), Spark (overhead batch cho ingest streaming), Cassandra/ScyllaDB (không có analytics), PostgreSQL/TimescaleDB (row-based, chậm ở TB+ analytics), Airflow (overhead scheduling không cần).
