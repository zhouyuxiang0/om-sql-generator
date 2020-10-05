interface Update {
    fieldCount: number,
    affectedRows: number,
    insertId: number,
    serverStatus: number,
    warningCount: number,
    message: string,
    protocol41: boolean,
    changedRows: number
}
function queryRunner<T extends 'select' | 'update' | 'delete' | 'insert'>(
    sql: string,
    params: any[]
): Promise<T extends 'select' ? { [key: string]: any }[] : (T extends 'update' ? Update : { [key: string]: any })> {
    return new Promise((resolve, reject) => {
        const result: T extends 'select' ? { [key: string]: any }[] :
        (T extends 'update' ? Update : (T extends 'delete' ? { [key: string]: any } : { [key: string]: any })) = void 0
        return resolve(result)
    })
}
type WithOut<T, U> = { [P in Exclude<keyof T, keyof U>]?: never }
type XOR<T, U> = (T | U) extends object ? (WithOut<T, U> & U) | (WithOut<U, T> & T) : T | U;
type AndOr = 'and' | 'or'
type expr<M> = [keyof M, Op, M[keyof M]]
type exprs<M> = [expr<M> | exprs<M>, 'and' | 'or', expr<M> | exprs<M>]
type onExpr<M, T> = [keyof M, Op, keyof T]
type onExprs<M, T> = [onExpr<M, T> | onExprs<M, T>, 'and' | 'or', onExpr<M, T> | onExprs<M, T>]
type AndOrGroup<M> = { [T in keyof M | AndOr]?: T extends keyof M ? XOR<M[T], [Op, M[T]]> : AndOrGroup<M> }[]
export type Where<M> = { [T in keyof M]?: XOR<XOR<XOR<M[T], [Op, M[T] | M[T][]]>, (() => unknown)>, undefined> } | exprs<M> | expr<M>
type Database = { [key: string]: EntityMetaData }
type EntityMetaData = { tableName: string, column: Column, databaseName: string }
type alias = string
type name = string
type Column = {
    name: string,
    alias: string,
    type: string,
    size: number,
    primaryKey: boolean,
    unionKey: boolean,
    autoIncrement: boolean,
    common: string,
    length: number,
    isNull: boolean,
}[]
type TableOption = {
    database: string,
    tableName?: string
}
type ColumnOption = {
    name?: string,
    comment?: string,
    primaryKey?: boolean
}
type On<T, U> = [keyof T, Op, keyof U]
type Combine<T, U> = T & U
export enum Op {
    eq = '=',
    ne = '!=',
    gt = '>',
    lt = '<',
    ge = '>=',
    le = '<=',
    in = 'IN',
    notIn = 'NOT IN',
    like = 'LIKE'
}
// type Include<M, T> = {
//     // TODO: 排除M类型
//     model: Combine<(new () => T), typeof Model>,
//     on: On<M, T>,
//     where?: Partial<M>
// }[]
type Attr<T> = (keyof T | [keyof T, string])[]
type IncludeItem<M, T> = {
    model: Combine<(new () => T), typeof Model>,
    on: onExprs<M, T> | onExpr<M, T>,
    where?: Where<T>,
    attr?: Attr<T>
}

const database: Database = {}

let column: Column = []

/**
 * 实体装饰器
 * @param tableOption 数据表选项
 */
export function Entity(tableOption: TableOption) {
    return (target: typeof Model) => {
        const entityMetaData: EntityMetaData = {
            column,
            tableName: tableOption?.tableName ? tableOption.tableName : target.name,
            databaseName: tableOption.database,
        }
        column = []
        database[target.name] = entityMetaData
    }
}

/**
 * 列装饰器
 * @param option 列选项
 */
export function Column(option?: ColumnOption) {
    return (target: unknown, propertyName: string, propertyDescriptor?: PropertyDescriptor) => {
        column.push({
            name: option?.name || propertyName,
            alias: propertyName,
            type: null,
            size: null,
            primaryKey: option?.primaryKey || false,
            unionKey: null,
            autoIncrement: null,
            common: option?.comment || null,
            length: null,
            isNull: null
        })
    }
}


// tslint:disable-next-line: no-any
export abstract class Model<T = any> {
    /**
     * 创建一条数据
     * @param this
     * @param model 要创建的新模型
     */
    public static async create<M extends Model>(
        this: (new () => M) & typeof Model,
        model: Partial<M>
    ): Promise<M> {
        const { databaseName, tableName } = this.getDbInfo()
        let sql = `INSERT INTO ${this.op(databaseName)}.${this.op(tableName)}`
        const rowTmp = []
        const valueTmp = []
        database[this.name].column.forEach(v => {
            let prop: string
            v.alias ? prop = v.alias : prop = v.name
            rowTmp.push(this.op(prop))
            if (model[prop] || model[prop] === '') {
                valueTmp.push('?')
            } else {
                valueTmp.push('DEFAULT')
            }
            // valueTmp.push(model[prop] || model[prop] === '' ? this.sqlParams.push(model[prop]) : 'DEFAULT')
        })
        sql = `${sql} (${rowTmp.join(' ,')}) VALUES (${valueTmp.join(' ,')})`
        const result = await this.raw<'insert'>(sql)
        if (result) {
            const modelInstance = new this()
            Object.keys(result[0]).forEach(v => {
                modelInstance[v] = result[0][v]
            })
            return modelInstance
        } else {
            return null
        }
    }

    /**
     * 更新数据库
     * @param dao 数据访问对象
     * @param where
     */
    public static async update<M extends Model>(
        this: (new () => M) & typeof Model,
        dao: Partial<M>,
        options?: { where?: Partial<M> }
    ): Promise<Update> {
        const { databaseName, tableName } = this.getDbInfo()
        let sql = `UPDATE ${this.op(databaseName)}.${this.op(tableName)} SET`
        sql = `${sql} ${this.formatUpdate(dao)}`
        if (options?.where) {
            const arr = this.formatWhereObj(databaseName, tableName, options.where)
            if (arr && arr.length > 0) sql = `${sql} WHERE ${arr.join(' AND ')}`
        }
        return await this.raw<'update'>(sql)
    }

    public static async findAll<M extends Model>(
        this: (new () => M) & typeof Model,
    ): Promise<M[]> {
        const { tableName, databaseName } = this.getDbInfo()
        const result = await this.raw<'select'>(`SELECT * FROM ${this.op(databaseName)}.${this.op(tableName)}`)
        const rows: M[] = []
        if (result.length > 0) {
            const keys = Object.keys(result[0])
            result.forEach(res => {
                const modelInstance = new this()
                keys.forEach(v => {
                    modelInstance[v] = res[v]
                })
                rows.push(modelInstance)
            })
        }
        return rows
    }

    public static async findById<M extends Model>(
        this: (new () => M) & typeof Model,
        id: number
    ): Promise<M> {
        const { tableName, databaseName } = this.getDbInfo()
        let idName: string = 'id'
        for (const v of database[this.name].column) {
            if (v.alias === 'id') {
                idName = v.name
            }
        }
        const result = await this.raw<'select'>(`SELECT * FROM ${this.op(databaseName)}.${this.op(tableName)} WHERE ${this.op(databaseName)}.${this.op(tableName)}.${this.op(idName)} = ? limit 1`, [id])
        if (result.length) {
            const keys = Object.keys(result[0])
            const modelInstance = new this()
            result.forEach(res => {
                keys.forEach(v => {
                    modelInstance[v] = res[v]
                })
            })
            return modelInstance
        } else {
            return null
        }
    }


    /**
     * ```js
     * //   where : {
     * //       id: 1,
     * //       name: a
     * //   }
     * // sql: where id = 1 and name = a
     * // where: [
     * //     ['id', Op.eq, 1],
     * //     'or',
     * //     [
     * //         ['id', Op.eq, 2],
     * //         'and',
     * //         ['name', Op.like, '%赵%']
     * //     ]
     * // ]
     * // sql: where id = 1 or (id = 2 and name like '%赵%')
     * ```
     * 查询并计数
     * @param this
     * @param option
     */
    public static async findAndCountAll<
        M, T, U, V, W extends Model
    >(
        this: Combine<(new () => M), typeof Model>,
        option?: {
            include?: [
                IncludeItem<M, T>,
                IncludeItem<M, U>?,
                IncludeItem<M, V>?,
                IncludeItem<M, W>?
            ],
            where?: Where<M>,
            attr?: Attr<M>,
            limit?: number,
            offset?: number,
            order?: [keyof M, 'DESC' | 'ASC'][]
        }
    ): Promise<{
        rows: unknown[];
        count: number;
    }> {
        const { databaseName, tableName } = this.getDbInfo()
        let sql = `SELECT`
        let where = `WHERE`
        let includeStr = ``
        const params = []
        sql = `${sql} ${this.attrFormat(databaseName, tableName, option?.attr)}`
        if (option?.include) {
            const arr = this.formatInclude(option.include)
            const whereArr = []
            let attrStr = ``
            arr.forEach(v => {
                includeStr = `${includeStr} ${v.include}`
                attrStr = `${attrStr} ${v.attr}`
                // sql = `${sql} ${v.include}`
                if (v.where[0]) whereArr.push(v.where[0])
                if (v.where[1]) params.push(...v.where[1])
            })
            sql = `${sql} ${attrStr ? `, ${attrStr}` : attrStr}`
            if (whereArr.length > 0) {
                where = `${where} ${whereArr.join(' AND ')}`
            }
        }
        sql = `${sql} FROM ${databaseName}.${tableName} ${includeStr}`
        sql = `${sql} ${where === 'WHERE' ? where : `${where} AND`}`
        if (option?.where) {
            const { sql: whereSql, params: whereParams } = this.formatWhere(databaseName, tableName, option.where)
            sql = `${sql} ${whereSql}`
            params.push(...whereParams)
        }
        if (option?.order) sql = `${sql} ${this.formatOrder(databaseName, tableName, option.order)}`
        if (option?.limit) sql = `${sql} LIMIT ${option.limit}`
        if (option?.offset || option?.offset === 0) sql = `${sql} OFFSET ${option.offset}`
        const result = await this.raw<'select'>(sql, params)
        const rows = []
        if (result.length > 0) {
            const keys = Object.keys(result[0])
            result.forEach(res => {
                const modelInstance = new this()
                keys.forEach(v => {
                    modelInstance[v] = res[v]
                })
                rows.push(modelInstance)
            })
        }
        return { rows, count: result.length }
    }

    /**
     * 查询一条数据
     * @param this
     * @param option 查询选项
     */
    public static async findOne<M extends Model>(
        this: (new () => M) & typeof Model,
        option?: { where?: Where<M>, attributes?: (keyof M)[] }
    ): Promise<M> {
        const { databaseName, tableName } = this.getDbInfo()
        let sql = `SELECT`
        const params = []
        sql = `${sql} ${this.attrFormat(databaseName, tableName, option.attributes)}`
        sql = `${sql} FROM ${databaseName}.${tableName}`
        if (option?.where) {
            const { sql: whereSql, params: whereParams } = this.formatWhere(databaseName, tableName, option.where)
            sql = `${sql} WHERE ${whereSql}`
            params.push(...whereParams)
        }
        const result = await this.raw<'select'>(`${sql} LIMIT 1`, params)
        if (result.length) {
            const modelInstance = new this()
            Object.keys(result[0]).forEach(v => {
                modelInstance[v] = result[0][v]
            })
            return modelInstance
        } else {
            return null
        }
    }

    /**
     * 执行一条原生sql
     * @param sql sql语句
     * @param params 参数
     */
    public static async raw<T extends 'select' | 'update' | 'delete' | 'insert'>(sql: string, params = []) {
        try {
            if (process.env.NODE_ENV !== 'production') console.log(`Executing (${this.getDbInfo().databaseName}): ${sql}`, params)
            return await queryRunner<T>(sql, params)
        } catch (e) {
            console.log(e)
        }
    }

    public static FIND_IN_SET(value: unknown) {
        return function FIND_IN_SET() {
            return [`(?, @)`, value]
        }
    }

    /**
     * 格式化查询字段
     * @param databaseName 库名
     * @param tableName 表名
     * @param attrs 查询字段
     */
    private static attrFormat<M extends Model>(databaseName: string, tableName: string, attrs: (keyof M | [keyof M, string])[]) {
        const tmp = []
        if (attrs) {
            attrs.forEach(attr => {
                let attrName: keyof M
                let attrAlias: string
                if (Array.isArray(attr)) {
                    attrName = attr[0]
                    attrAlias = attr[1]
                } else {
                    attrName = attr
                }
                database[this.name].column.forEach(v => {
                    if (v.name === attrName) {
                        attrAlias ? tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)} AS ${this.op(attrAlias)}`) :
                            tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)}`)
                    } else if (v.alias === attrName) {
                        attrAlias ? tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)} AS ${this.op(attrAlias)}`) :
                            tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)} AS ${this.op(v.alias)}`)
                    }
                })
            })
        } else {
            database[this.name].column.forEach(v => {
                if (v.alias === v.name) {
                    tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)}`)
                } else {
                    tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.name)} AS ${this.op(v.alias)}`)
                }
            })
        }
        return tmp.join(', ')
    }

    private static op(str: string) {
        return `\`${str}\``
    }

    private static getDbInfo(): { databaseName: string, tableName: string } {
        return {
            databaseName: database[this.name].databaseName,
            tableName: database[this.name].tableName
        }
    }

    /**
     * 格式化where选项
     * @param databaseName 库名
     * @param tableName 表名
     * @param where where选项
     */
    private static formatWhere<M extends Model>(
        this: (new () => M) & typeof Model,
        databaseName: string,
        tableName: string,
        where: Where<M>
    ): { sql: string, params: any[] } {
        const str = ''
        if (Array.isArray(where)) {
            const params = this.travelWhere(where)
            const [...arr] = JSON.stringify(where)
            arr.shift()
            arr.pop()
            const sql = arr.join('').replace(/\"/g, '').split('[').map(v => {
                const ar = v.split(',')
                database[this.name].column.forEach(col => {
                    if (col.name === col.alias && col.name === ar[0].trim()) {
                        ar[0] = `${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`
                    } else if (col.alias === ar[0].trim()) {
                        ar[0] = `${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`
                    }
                })
                return ar.join(',')
            }).join('[').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\,/g, ' ')
            return { sql, params }
        } else {
            const tmp = []
            const keys = Object.keys(where)
            const params = []
            if (keys.length <= 0) return { sql: ``, params }
            keys.forEach(v => {
                let op = '='
                if (Array.isArray(where[v])) {
                    params.push(where[v][1])
                    op = where[v][0]
                } else if (where[v] instanceof Function) {
                    params.push(where[v]()[1])
                } else {
                    if (where[v] !== void 0) params.push(where[v])
                }
                database[this.name].column.forEach(col => {
                    if (col.alias === v && where[v] !== void 0) {
                        where[v] instanceof Function ? tmp.push(`${(where[v] as () => unknown).name}${(where[v]()[0] as string).replace('@', `${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`)}`) :
                            tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)} ${op} ${([Op.in, Op.notIn] as string[]).includes(op) ? '(?)' : '?'}`)
                    }
                })
            })
            return { sql: `${str} ${tmp.join(' AND ')}`, params }
        }
    }

    private static formatWhereObj(databaseName, tableName, whereObj) {
        const tmp = []
        const keys = Object.keys(whereObj)
        if (keys.length <= 0) return ''
        database[this.name].column.forEach(v => {
            keys.forEach(prop => {
                const op = Array.isArray(whereObj[prop]) ? whereObj[prop][0] : Op.eq
                if (v.alias && v.alias === prop) {
                    tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(v.alias)} ${Array.isArray(whereObj[prop]) ? `${op} ${whereObj[prop][1]}` : `${op} ${whereObj[prop]}`}`)
                } else if (v.name === prop) {
                    tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(prop)} ${Array.isArray(whereObj[prop]) ? `${op} ${whereObj[prop][1]}` : `${op} ${whereObj[prop]}`}`)
                }
            })
        })
        return tmp
    }

    private static formatOn<M, T>(
        model: Combine<(new () => T), typeof Model>,
        on: On<M, T>
    ) {
        if (Array.isArray(on) && on.length === 3) {
            // tslint:disable-next-line: prefer-const
            let [left, op, right] = on
            const leftInfo = this.getDbInfo()
            database[this.name].column.forEach(v => {
                if (v.alias && v.alias === left) {
                    left = v.name as keyof M
                }
            })
            database[model.name].column.forEach(v => {
                if (v.alias && v.alias === left) {
                    right = v.name as keyof T
                }
            })
            const rightInfo = model.getDbInfo()
            return `ON ${this.op(leftInfo.databaseName)}.${this.op(leftInfo.tableName)}.${this.op(left as string)} ${op} ${this.op(rightInfo.databaseName)}.${this.op(rightInfo.tableName)}.${this.op(right as string)}`
        }
        return ''
    }

    /**
     * 格式化order参数
     * @param databaseName
     * @param tableName
     * @param order
     */
    private static formatOrder<M extends Model>(databaseName: string, tableName: string, order: [keyof M, 'DESC' | 'ASC'][]) {
        const str = `ORDER BY`
        const tmp = []
        let last: string
        order.forEach(v => {
            database[this.name].column.forEach(col => {
                if (col.alias && col.alias === v[0]) {
                    if (!last || last === v[1]) {
                        tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`)
                        last = v[1]
                    } else {
                        tmp.push(`${last} , ${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`)
                    }
                } else if (col.name === v[0]) {
                    if (!last || last === v[1]) {
                        tmp.push(`${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`)
                        last = v[1]
                    } else {
                        tmp.push(`${last} , ${this.op(databaseName)}.${this.op(tableName)}.${this.op(col.name)}`)
                    }
                }
            })
            last = v[1]
        })
        return `${str} ${tmp.join(' ')} ${last}`
    }

    private static formatUpdate<M extends Model>(dao: Partial<M>) {
        const tmp = []
        const keys = Object.keys(dao)
        database[this.name].column.forEach(v => {
            keys.forEach(prop => {
                if (v.alias && v.alias === prop) {
                    tmp.push(`${this.op(v.name)} = ${dao[prop]}`)
                } else if (v.name === prop) {
                    tmp.push(`${this.op(prop)} = ${dao[prop]}`)
                }
            })
        })
        return `${tmp.join(',')}`
    }

    private static formatInclude<M extends Model>(
        this: (new () => M) & typeof Model,
        include: IncludeItem<any, any>[]
    ): { include: string, where: [string, (string | number)[]], attr: string }[] {
        const tmp: { include: string, where: [string, (string | number)[]], attr: string }[] = []
        include.forEach(v => {
            let includeFormat: string
            let attrFormat: string
            // let whereFormat: string
            const { tableName: modelTableName, databaseName: modelDatabase } = v.model.getDbInfo()
            this.travelOn(v.model, v.on)
            const [...arr] = JSON.stringify(v.on)
            arr.shift()
            arr.pop()
            includeFormat = `LEFT JOIN ${this.op(modelDatabase)}.${this.op(modelTableName)} ON ${arr.join('')
                .replace(/\"/g, '')
                .replace(/\,/g, ' ')
                .replace(/\[/g, '(')
                .replace(/\]/g, ')')}`
            let whereSql: string
            let whereParams: any[]
            if (v?.where) {
                const { sql, params } = v.model.formatWhere(modelDatabase, modelTableName, v.where)
                whereSql = sql
                whereParams = params
            }
            if (v?.attr) {
                attrFormat = v.model.attrFormat(modelDatabase, modelTableName, v.attr as Attr<typeof v.model>)
            }
            tmp.push({ include: includeFormat, where: [whereSql, whereParams], attr: attrFormat })
        })
        return tmp
    }

    private static travelOn<M extends Model, T extends Model>(
        this: (new () => M) & typeof Model,
        joinModel: (new () => T) & typeof Model,
        arr: any[]
    ) {
        const { tableName, databaseName } = this.getDbInfo()
        const modelTableName = joinModel.getDbInfo().tableName
        const modelDatabaseName = joinModel.getDbInfo().databaseName
        if (Array.isArray(arr[0])) {
            this.travelOn(joinModel, arr[0])
        } else {
            database[this.name].column.forEach(col => {
                if (col.alias === arr[0]) {
                    arr[0] = col.name
                }
            })
            database[joinModel.name].column.forEach(col => {
                if (col.alias === arr[2]) {
                    arr[2] = col.name
                }
            })
            arr[0] = `${this.op(databaseName)}.${this.op(tableName)}.${this.op(arr[0])}`
        }
        if (Array.isArray(arr[2])) {
            this.travelOn(joinModel, arr[2])
        } else {
            database[joinModel.name].column.forEach(col => {
                if (col.alias === arr[0]) {
                    arr[0] = col.name
                }
            })
            database[joinModel.name].column.forEach(col => {
                if (col.alias === arr[2]) {
                    arr[2] = col.name
                }
            })
            arr[2] = `${this.op(modelDatabaseName)}.${this.op(modelTableName)}.${this.op(arr[2])}`
        }
    }

    private static travelWhere<M extends Model, T extends Model>(
        this: (new () => M) & typeof Model,
        where: any[]
    ): (string | number)[] {
        const params = []
        if (Array.isArray(where[0])) {
            params.push(...this.travelWhere(where[0]))
        } else {
            if (where[2] !== '?') params.push(where[2])
            where[2] = '?'
        }
        if (Array.isArray(where[1])) {
            params.push(where[1])
        } else if (Array.isArray(where[2])) {
            params.push(...this.travelWhere(where[2]))
        } else {
            if (where[2] !== '?') params.push(where[2])
            where[2] = '?'
        }
        return params
    }
}

